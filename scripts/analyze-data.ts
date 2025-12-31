import Database from "better-sqlite3";
import { join } from "path";

const DB_PATH = join(process.cwd(), "tmp", "ofac-cache.db");
const db = new Database(DB_PATH, { readonly: true });

console.log("=== ENTITY TYPES ===");
const entityTypes = db.prepare(`
  SELECT entity_type, list, COUNT(*) as count 
  FROM entities 
  GROUP BY entity_type, list 
  ORDER BY count DESC
`).all();
console.table(entityTypes);

console.log("\n=== COUNTRIES (Top 30) ===");
const countries = db.prepare(`
  SELECT country, COUNT(*) as count 
  FROM addresses 
  WHERE country IS NOT NULL
  GROUP BY country 
  ORDER BY count DESC
  LIMIT 30
`).all();
console.table(countries);

console.log("\n=== ID TYPES (Top 20) ===");
const idTypes = db.prepare(`
  SELECT id_type, COUNT(*) as count 
  FROM identifications 
  WHERE id_type IS NOT NULL
  GROUP BY id_type 
  ORDER BY count DESC
  LIMIT 20
`).all();
console.table(idTypes);

console.log("\n=== ALIAS TYPES ===");
const aliasTypes = db.prepare(`
  SELECT alias_type, COUNT(*) as count 
  FROM names 
  GROUP BY alias_type 
  ORDER BY count DESC
`).all();
console.table(aliasTypes);

console.log("\n=== SCRIPTS (Name Scripts) ===");
const scripts = db.prepare(`
  SELECT script, COUNT(*) as count 
  FROM names 
  WHERE script IS NOT NULL
  GROUP BY script 
  ORDER BY count DESC
`).all();
console.table(scripts);

console.log("\n=== SAMPLE NAMES (first 10) ===");
const sampleNames = db.prepare(`
  SELECT n.name, n.is_primary, n.alias_type, e.entity_type, e.list
  FROM names n
  JOIN entities e ON n.entity_id = e.id AND n.list = e.list
  LIMIT 10
`).all();
console.table(sampleNames);

console.log("\n=== ENTITIES WITH MOST NAMES ===");
const mostNames = db.prepare(`
  SELECT e.id, e.primary_name, e.entity_type, e.list, COUNT(n.id) as name_count
  FROM entities e
  JOIN names n ON n.entity_id = e.id AND n.list = e.list
  GROUP BY e.id, e.list
  ORDER BY name_count DESC
  LIMIT 10
`).all();
console.table(mostNames);

console.log("\n=== ENTITIES WITH MOST ADDRESSES ===");
const mostAddresses = db.prepare(`
  SELECT e.id, e.primary_name, e.entity_type, COUNT(a.id) as address_count
  FROM entities e
  JOIN addresses a ON a.entity_id = e.id AND a.list = e.list
  GROUP BY e.id, e.list
  ORDER BY address_count DESC
  LIMIT 10
`).all();
console.table(mostAddresses);

console.log("\n=== CITIES (Top 20) ===");
const cities = db.prepare(`
  SELECT city, country, COUNT(*) as count 
  FROM addresses 
  WHERE city IS NOT NULL
  GROUP BY city, country 
  ORDER BY count DESC
  LIMIT 20
`).all();
console.table(cities);

console.log("\n=== DATA COVERAGE ===");
const coverage = db.prepare(`
  SELECT 
    (SELECT COUNT(*) FROM entities) as total_entities,
    (SELECT COUNT(DISTINCT entity_id || '-' || list) FROM names) as entities_with_names,
    (SELECT COUNT(DISTINCT entity_id || '-' || list) FROM addresses) as entities_with_addresses,
    (SELECT COUNT(DISTINCT entity_id || '-' || list) FROM identifications) as entities_with_ids
`).get();
console.table([coverage]);
