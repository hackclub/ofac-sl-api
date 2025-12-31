import { mkdirSync, writeFileSync, readFileSync } from "fs";
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

function parseZip(zipPath: string): unknown {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const xmlEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".xml"));
  if (!xmlEntry) throw new Error("No XML found");
  return parser.parse(xmlEntry.getData().toString("utf-8"));
}

const sdnPath = join(TMP_DIR, "SDN_ENHANCED.ZIP");
const consPath = join(TMP_DIR, "CONS_ENHANCED.ZIP");

console.log("Parsing SDN...");
const sdn = parseZip(sdnPath) as any;

console.log("Parsing CONS...");
const cons = parseZip(consPath) as any;

// Write sample structure
const sdnData = sdn.sanctionsData;

// Get first few entities
const entities = sdnData.entities?.entity?.slice(0, 3) ?? [];

// Get SDN TYPE reference values
const refs = sdnData.referenceValues?.referenceValue ?? [];
const sdnTypeRefs = refs.filter((r: any) => r.type === "SDN TYPE");

const output = {
  sampleEntities: entities,
  sdnTypeReferences: sdnTypeRefs,
  topLevelKeys: Object.keys(sdnData),
  entityCount: sdnData.entities?.entity?.length ?? 0,
  consEntityCount: cons.sanctionsData?.entities?.entity?.length ?? 0,
};

writeFileSync(
  join(TMP_DIR, "structure.json"),
  JSON.stringify(output, null, 2)
);

console.log("Written to tmp/structure.json");
console.log("Entity count (SDN):", output.entityCount);
console.log("Entity count (CONS):", output.consEntityCount);
console.log("SDN TYPE refs:", sdnTypeRefs.map((r: any) => r.value));
