import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type Database from "better-sqlite3";
import type { SanctionsData } from "../types/ofac.js";
import { loadListIntoDatabaseInstance, getDatabase, setLastFetched } from "./database.js";

const OFAC_API_BASE = "https://sanctionslistservice.ofac.treas.gov/api/download";
const TMP_DIR = join(process.cwd(), "tmp");
const SDN_ZIP_PATH = join(TMP_DIR, "SDN_ENHANCED.ZIP");
const CONS_ZIP_PATH = join(TMP_DIR, "CONS_ENHANCED.ZIP");

async function downloadFile(filename: string): Promise<Buffer> {
  const url = `${OFAC_API_BASE}/${filename}`;
  console.log(`Downloading ${url}...`);

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "ofac-sdn-api/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${filename}: ${buffer.length} bytes`);
  return buffer;
}

async function unzipAndParse(zipBuffer: Buffer, zipFilename: string): Promise<SanctionsData> {
  return new Promise((resolve, reject) => {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      const xmlEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".xml"));
      if (!xmlEntry) {
        reject(new Error(`No XML file found in ${zipFilename}`));
        return;
      }

      const xmlContent = xmlEntry.getData().toString("utf-8");
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        parseAttributeValue: true,
        parseTagValue: true,
      });

      resolve(parser.parse(xmlContent));
    } catch (err) {
      reject(err);
    }
  });
}

async function downloadParseAndLoad(
  filename: string,
  localPath: string,
  list: "sdn" | "cons",
  database: Database.Database,
  forceDownload: boolean = false
): Promise<void> {
  let buffer: Buffer;
  
  if (!forceDownload && existsSync(localPath)) {
    console.log(`Using cached ${filename}`);
    buffer = readFileSync(localPath);
  } else {
    buffer = await downloadFile(filename);
    writeFileSync(localPath, buffer);
  }
  
  console.log(`Parsing ${filename}...`);
  const data = await unzipAndParse(buffer, filename);
  
  loadListIntoDatabaseInstance(database, data, list);
}

export async function downloadAndProcessOFACData(
  database?: Database.Database,
  forceDownload: boolean = false
): Promise<void> {
  mkdirSync(TMP_DIR, { recursive: true });

  console.log("Loading OFAC SDN and Consolidated lists...");

  const targetDb = database ?? getDatabase();

  await Promise.all([
    downloadParseAndLoad("SDN_ENHANCED.ZIP", SDN_ZIP_PATH, "sdn", targetDb, forceDownload),
    downloadParseAndLoad("CONS_ENHANCED.ZIP", CONS_ZIP_PATH, "cons", targetDb, forceDownload),
  ]);

  setLastFetched(new Date());
  console.log("OFAC data loaded successfully");
}
