import { readFileSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const TMP_DIR = join(process.cwd(), "tmp");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  parseTagValue: true,
});

function parseZip(zipPath: string): any {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".xml"));
  if (!xmlEntry) throw new Error("No XML found");
  return parser.parse(xmlEntry.getData().toString("utf-8"));
}

function getKeys(obj: any, prefix = ""): Set<string> {
  const keys = new Set<string>();
  if (obj === null || obj === undefined) return keys;
  if (typeof obj !== "object") return keys;
  
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);
    
    const value = obj[key];
    if (Array.isArray(value) && value.length > 0) {
      const childKeys = getKeys(value[0], fullKey + "[]");
      childKeys.forEach(k => keys.add(k));
    } else if (typeof value === "object" && value !== null) {
      const childKeys = getKeys(value, fullKey);
      childKeys.forEach(k => keys.add(k));
    }
  }
  return keys;
}

function getEntityStructure(entity: any): Set<string> {
  return getKeys(entity);
}

function getSampleValues(data: any, path: string): any[] {
  const parts = path.split(".");
  let current = [data];
  
  for (const part of parts) {
    const next: any[] = [];
    for (const item of current) {
      if (item === null || item === undefined) continue;
      if (part.endsWith("[]")) {
        const key = part.slice(0, -2);
        const val = item[key];
        if (Array.isArray(val)) next.push(...val.slice(0, 3));
        else if (val) next.push(val);
      } else {
        const val = item[part];
        if (val !== undefined) next.push(val);
      }
    }
    current = next;
  }
  return current.slice(0, 5);
}

console.log("Parsing SDN...");
const sdn = parseZip(join(TMP_DIR, "SDN_ENHANCED.ZIP"));

console.log("Parsing CONS...");
const cons = parseZip(join(TMP_DIR, "CONS_ENHANCED.ZIP"));

const sdnData = sdn.sanctionsData;
const consData = cons.sanctionsData;

console.log("\n=== TOP LEVEL KEYS ===");
console.log("SDN:", Object.keys(sdnData));
console.log("CONS:", Object.keys(consData));

const sdnEntities = sdnData.entities?.entity || [];
const consEntities = consData.entities?.entity || [];

console.log("\n=== ENTITY COUNTS ===");
console.log("SDN entities:", sdnEntities.length);
console.log("CONS entities:", consEntities.length);

// Sample entities from each
const sdnSample = sdnEntities.slice(0, 10);
const consSample = consEntities.slice(0, 10);

// Get all unique keys from samples
const sdnEntityKeys = new Set<string>();
const consEntityKeys = new Set<string>();

for (const e of sdnEntities.slice(0, 100)) {
  getEntityStructure(e).forEach(k => sdnEntityKeys.add(k));
}
for (const e of consEntities) {
  getEntityStructure(e).forEach(k => consEntityKeys.add(k));
}

console.log("\n=== ENTITY STRUCTURE COMPARISON ===");
console.log("SDN entity keys:", sdnEntityKeys.size);
console.log("CONS entity keys:", consEntityKeys.size);

// Find keys only in SDN
const onlyInSdn = [...sdnEntityKeys].filter(k => !consEntityKeys.has(k));
const onlyInCons = [...consEntityKeys].filter(k => !sdnEntityKeys.has(k));

if (onlyInSdn.length > 0) {
  console.log("\n--- Keys ONLY in SDN ---");
  onlyInSdn.sort().forEach(k => console.log(" ", k));
}

if (onlyInCons.length > 0) {
  console.log("\n--- Keys ONLY in CONS ---");
  onlyInCons.sort().forEach(k => console.log(" ", k));
}

// Compare reference values
const sdnRefs = sdnData.referenceValues?.referenceValue || [];
const consRefs = consData.referenceValues?.referenceValue || [];

console.log("\n=== REFERENCE VALUES ===");
console.log("SDN reference values:", sdnRefs.length);
console.log("CONS reference values:", consRefs.length);

// Get unique reference types
const sdnRefTypes = new Set(sdnRefs.map((r: any) => r.type));
const consRefTypes = new Set(consRefs.map((r: any) => r.type));

console.log("\nSDN ref types:", [...sdnRefTypes].sort());
console.log("CONS ref types:", [...consRefTypes].sort());

// Check SDN TYPE values
const sdnTypeValues = sdnRefs.filter((r: any) => r.type === "SDN TYPE").map((r: any) => r.value);
const consTypeValues = consRefs.filter((r: any) => r.type === "SDN TYPE").map((r: any) => r.value);

console.log("\n=== SDN TYPE VALUES ===");
console.log("SDN:", sdnTypeValues);
console.log("CONS:", consTypeValues);

// Sample a CONS entity to see structure
console.log("\n=== SAMPLE CONS ENTITY ===");
if (consEntities.length > 0) {
  console.log(JSON.stringify(consEntities[0], null, 2).slice(0, 3000));
}

// Check entity types distribution in CONS
const consEntityTypes = new Map<string, number>();
for (const e of consEntities) {
  const typeText = e.generalInfo?.entityType?.["#text"] || "Unknown";
  consEntityTypes.set(typeText, (consEntityTypes.get(typeText) || 0) + 1);
}
console.log("\n=== CONS ENTITY TYPE DISTRIBUTION ===");
console.log([...consEntityTypes.entries()]);

// Check if any CONS entities have features/identifications
let consWithFeatures = 0;
let consWithAddresses = 0;
let consWithNames = 0;
for (const e of consEntities) {
  if (e.features) consWithFeatures++;
  if (e.addresses) consWithAddresses++;
  if (e.names) consWithNames++;
}
console.log("\n=== CONS DATA COVERAGE ===");
console.log("With features:", consWithFeatures, "/", consEntities.length);
console.log("With addresses:", consWithAddresses, "/", consEntities.length);
console.log("With names:", consWithNames, "/", consEntities.length);
