import { readFileSync, existsSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import type { SanctionsData, Entity } from "../types/ofac.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "..", "schema.sql");
const TMP_DIR = join(process.cwd(), "tmp");
const DB_CACHE_PATH = join(TMP_DIR, "ofac-cache.db");
const SDN_ZIP_PATH = join(TMP_DIR, "SDN_ENHANCED.ZIP");
const CONS_ZIP_PATH = join(TMP_DIR, "CONS_ENHANCED.ZIP");

let db: Database.Database | null = null;
let lastFetched: Date | null = null;

export function getLastFetched(): Date | null {
  return lastFetched;
}

export function setLastFetched(date: Date): void {
  lastFetched = date;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

function createSchema(database: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  database.exec(schema);
}

function getEntities(data: SanctionsData): Entity[] {
  const entities = data.sanctionsData?.entities?.entity;
  if (!entities) return [];
  return Array.isArray(entities) ? entities : [entities];
}

function extractNames(entity: Entity): Array<{ name: string; isPrimary: boolean; aliasType?: string; script?: string }> {
  const names: Array<{ name: string; isPrimary: boolean; aliasType?: string; script?: string }> = [];
  const nameData = (entity as any).names?.name;
  if (!nameData) return names;

  const nameList = Array.isArray(nameData) ? nameData : [nameData];
  for (const n of nameList) {
    const translations = n.translations?.translation;
    const transList = translations ? (Array.isArray(translations) ? translations : [translations]) : [];
    
    for (const t of transList) {
      const fullName = t.formattedFullName;
      if (fullName) {
        names.push({
          name: fullName,
          isPrimary: n.isPrimary === true,
          aliasType: n.aliasType?.["#text"],
          script: t.script?.["#text"],
        });
      }
    }
  }
  return names;
}

function extractAddresses(entity: Entity): Array<{ country?: string; countryCode?: string; city?: string; address1?: string; postalCode?: string }> {
  const addresses: Array<{ country?: string; countryCode?: string; city?: string; address1?: string; postalCode?: string }> = [];
  const addrData = (entity as any).addresses?.address;
  if (!addrData) return addresses;

  const addrList = Array.isArray(addrData) ? addrData : [addrData];
  for (const a of addrList) {
    const country = a.country?.["#text"];
    const countryCode = a.country?.["@_isoCode"];
    
    const translations = a.translations?.translation;
    const transList = translations ? (Array.isArray(translations) ? translations : [translations]) : [];
    
    for (const t of transList) {
      const parts = t.addressParts?.addressPart;
      const partList = parts ? (Array.isArray(parts) ? parts : [parts]) : [];
      
      const addr: { country?: string; countryCode?: string; city?: string; address1?: string; postalCode?: string } = {
        country,
        countryCode,
      };
      
      for (const p of partList) {
        const type = p.type?.["#text"];
        const value = p.value;
        if (type === "CITY") addr.city = value;
        else if (type === "ADDRESS1") addr.address1 = value;
        else if (type === "POSTAL CODE") addr.postalCode = String(value);
      }
      
      addresses.push(addr);
    }
  }
  return addresses;
}

function extractIdentifications(entity: Entity): Array<{ idType?: string; idValue?: string; country?: string }> {
  const ids: Array<{ idType?: string; idValue?: string; country?: string }> = [];
  
  // Extract from features (SDN and CONS)
  const features = (entity as any).features?.feature;
  if (features) {
    const featureList = Array.isArray(features) ? features : [features];
    for (const f of featureList) {
      const featureType = f.featureType?.["#text"];
      if (!featureType) continue;

      const versions = f.versions?.version;
      const versionList = versions ? (Array.isArray(versions) ? versions : [versions]) : [];
      
      for (const v of versionList) {
        const details = v.details?.detail;
        const detailList = details ? (Array.isArray(details) ? details : [details]) : [];
        
        for (const d of detailList) {
          const value = d.value ?? d.detailValue?.["#text"];
          if (value) {
            ids.push({
              idType: featureType,
              idValue: String(value),
              country: d.country?.["#text"],
            });
          }
        }
      }
    }
  }

  // Extract from identityDocuments (CONS-specific)
  const identityDocs = (entity as any).identityDocuments?.identityDocument;
  if (identityDocs) {
    const docList = Array.isArray(identityDocs) ? identityDocs : [identityDocs];
    for (const doc of docList) {
      const docNumber = doc.documentNumber ?? doc.number ?? doc.idNumber;
      if (!docNumber) continue;

      ids.push({
        idType: doc.documentType?.["#text"] ?? doc.type?.["#text"] ?? "Identity Document",
        idValue: String(docNumber),
        country: doc.issuingCountry?.["#text"] ?? doc.country?.["#text"],
      });
    }
  }

  return ids;
}

function loadEntities(database: Database.Database, data: SanctionsData, list: "sdn" | "cons", refMap: Map<number, string>): void {
  const entities = getEntities(data);
  
  const insertEntity = database.prepare(`
    INSERT INTO entities (id, identity_id, entity_type, list, primary_name)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const insertName = database.prepare(`
    INSERT INTO names (entity_id, list, name, is_primary, alias_type, script)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const insertAddress = database.prepare(`
    INSERT INTO addresses (entity_id, list, country, country_code, city, address1, postal_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertId = database.prepare(`
    INSERT INTO identifications (entity_id, list, id_type, id_value, country)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction(() => {
    for (const entity of entities) {
      const entityId = entity["@_id"];
      const identityId = entity.generalInfo?.identityId;
      const entityTypeNode = entity.generalInfo?.entityType;
      const typeRefId = entityTypeNode?.["@_refId"];
      const inlineTypeText = entityTypeNode?.["#text"];
      const entityType = (typeof typeRefId === "number" ? refMap.get(typeRefId) : undefined) ?? inlineTypeText ?? "Unknown";
      
      const names = extractNames(entity);
      const primaryName = names.find((n) => n.isPrimary)?.name ?? names[0]?.name ?? null;
      
      insertEntity.run(entityId, identityId, entityType, list, primaryName);
      
      for (const name of names) {
        insertName.run(entityId, list, name.name, name.isPrimary ? 1 : 0, name.aliasType ?? null, name.script ?? null);
      }
      
      for (const addr of extractAddresses(entity)) {
        insertAddress.run(entityId, list, addr.country ?? null, addr.countryCode ?? null, addr.city ?? null, addr.address1 ?? null, addr.postalCode ?? null);
      }
      
      for (const id of extractIdentifications(entity)) {
        insertId.run(entityId, list, id.idType ?? null, id.idValue ?? null, id.country ?? null);
      }
    }
  });

  insertMany();
}

function buildRefIdToTypeMap(data: SanctionsData): Map<number, string> {
  const refs = data.sanctionsData?.referenceValues?.referenceValue;
  if (!refs) return new Map();
  const refList = Array.isArray(refs) ? refs : [refs];
  const typeRefs = refList.filter((r) => r.type === "SDN TYPE");
  const map = new Map<number, string>();
  for (const ref of typeRefs) {
    map.set(ref["@_refId"], ref.value);
  }
  return map;
}

export function isCacheValid(): boolean {
  if (!existsSync(DB_CACHE_PATH)) return false;
  if (!existsSync(SDN_ZIP_PATH) || !existsSync(CONS_ZIP_PATH)) return false;

  const dbTime = statSync(DB_CACHE_PATH).mtimeMs;
  const sdnTime = statSync(SDN_ZIP_PATH).mtimeMs;
  const consTime = statSync(CONS_ZIP_PATH).mtimeMs;

  return dbTime > sdnTime && dbTime > consTime;
}

export function initializeDatabaseFromCache(): Database.Database {
  console.log("Loading database from cache...");
  const cacheBuffer = readFileSync(DB_CACHE_PATH);
  db = new Database(cacheBuffer, { readonly: true });
  db.pragma("cache_size = -64000");
  
  lastFetched = statSync(DB_CACHE_PATH).mtime;
  
  logDatabaseStats(db);
  return db;
}

function logDatabaseStats(database: Database.Database): void {
  const entityCount = database.prepare("SELECT COUNT(*) as count FROM entities").get() as { count: number };
  const nameCount = database.prepare("SELECT COUNT(*) as count FROM names").get() as { count: number };
  const addressCount = database.prepare("SELECT COUNT(*) as count FROM addresses").get() as { count: number };
  const idCount = database.prepare("SELECT COUNT(*) as count FROM identifications").get() as { count: number };
  
  const sdnCount = database.prepare("SELECT COUNT(*) as count FROM entities WHERE list = 'sdn'").get() as { count: number };
  const consCount = database.prepare("SELECT COUNT(*) as count FROM entities WHERE list = 'cons'").get() as { count: number };
  const unknownTypes = database.prepare("SELECT COUNT(*) as count FROM entities WHERE entity_type = 'Unknown'").get() as { count: number };
  
  console.log(`  Entities: ${entityCount.count} (SDN: ${sdnCount.count}, CONS: ${consCount.count})`);
  console.log(`  Names: ${nameCount.count}, Addresses: ${addressCount.count}, IDs: ${idCount.count}`);
  if (unknownTypes.count > 0) {
    console.warn(`  Warning: ${unknownTypes.count} entities with Unknown type`);
  }
}

export function createInMemoryDatabaseInstance(): Database.Database {
  console.log("Initializing in-memory SQLite database (instance)...");
  const database = new Database(":memory:");
  database.pragma("journal_mode = OFF");
  database.pragma("synchronous = OFF");
  database.pragma("cache_size = -64000");
  createSchema(database);
  return database;
}

export function createDatabase(): void {
  db = createInMemoryDatabaseInstance();
}

export function loadListIntoDatabaseInstance(
  database: Database.Database,
  data: SanctionsData,
  list: "sdn" | "cons",
  fallbackRefMap?: Map<number, string>
): void {
  const refMap = buildRefIdToTypeMap(data);
  const combinedRefMap = fallbackRefMap ? new Map([...fallbackRefMap, ...refMap]) : refMap;
  
  console.log(`Loading ${list.toUpperCase()} entities...`);
  loadEntities(database, data, list, combinedRefMap);
}

export function loadListIntoDatabase(data: SanctionsData, list: "sdn" | "cons", fallbackRefMap?: Map<number, string>): void {
  if (!db) throw new Error("Database not initialized");
  loadListIntoDatabaseInstance(db, data, list, fallbackRefMap);
}

export function finalizeDatabaseInstance(database: Database.Database): Database.Database {
  console.log("Database initialized:");
  logDatabaseStats(database);
  
  console.log("Caching database to disk...");
  const serialized = database.serialize();
  writeFileSync(DB_CACHE_PATH, serialized);
  
  database.close();
  const reopened = new Database(serialized, { readonly: true });
  reopened.pragma("cache_size = -64000");
  
  return reopened;
}

export function finalizeDatabase(): Database.Database {
  if (!db) throw new Error("Database not initialized");
  db = finalizeDatabaseInstance(db);
  return db;
}

export function swapDatabase(newDb: Database.Database): void {
  const oldDb = db;
  db = newDb;
  lastFetched = new Date();

  // Delay closing old DB to allow in-flight requests to complete
  if (oldDb) {
    setTimeout(() => {
      try {
        oldDb.close();
      } catch {
        // Already closed or GC'd
      }
    }, 30_000); // 30 seconds should be enough for any request to finish
  }
}
