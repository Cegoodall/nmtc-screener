/**
 * Download and convert Treasury Opportunity Zones tract list to JSON.
 * Output: public/oz-tracts.json — array of 11-digit GEOID strings
 *
 * Run: node scripts/process-oz-data.mjs
 *
 * Source: https://www.irs.gov/credits-deductions/opportunity-zones
 */

import { createWriteStream, writeFileSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP_FILE = path.join(ROOT, "scripts", "oz-raw.xlsx");
const OUT_FILE = path.join(ROOT, "public", "oz-tracts.json");

// Known OZ data URLs — try in order
const OZ_URLS = [
  "https://www.irs.gov/pub/irs-utl/opportunity_zones_eligible_tracts.xlsx",
  "https://www.cdfifund.gov/sites/cdfi/files/2019-04/OZ%20Eligible%20Census%20Tracts%20List.xlsx",
  "https://home.treasury.gov/system/files/136/Designated-QOZ-as-of-date-of-enactment-of-the-Tax-Cuts-and-Jobs-Act.csv",
];

async function tryDownload() {
  for (const url of OZ_URLS) {
    try {
      console.log(`Trying: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dest = url.endsWith(".csv")
        ? TMP_FILE.replace(".xlsx", ".csv")
        : TMP_FILE;
      const ws = createWriteStream(dest);
      await pipeline(res.body, ws);
      console.log(`Downloaded to: ${dest}`);
      return dest;
    } catch (e) {
      console.warn(`Failed: ${e.message}`);
    }
  }
  throw new Error("All OZ URLs failed. Download manually and place at scripts/oz-raw.xlsx");
}

async function parseFile(filePath) {
  if (filePath.endsWith(".csv")) {
    const { readFileSync } = await import("fs");
    const text = readFileSync(filePath, "utf8");
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const geoids = [];
    for (const line of lines.slice(1)) { // skip header
      const parts = line.split(",");
      for (const part of parts) {
        const clean = part.replace(/["'\s]/g, "");
        if (/^\d{10,11}$/.test(clean)) {
          geoids.push(clean.padStart(11, "0"));
        }
      }
    }
    return geoids;
  }

  const XLSX = await import("xlsx").then(m => m.default || m);
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

  const headers = Object.keys(rows[0] || {});
  console.log("OZ columns:", headers.join(", "));

  // Find GEOID column
  const geoidCol = headers.find(h =>
    /geoid|tract|census/i.test(h)
  );
  if (!geoidCol) {
    console.error("First row:", rows[0]);
    throw new Error("Cannot find GEOID column in OZ file");
  }

  const geoids = rows
    .map(r => String(r[geoidCol] || "").trim().replace(/\.0$/, "").padStart(11, "0"))
    .filter(g => /^\d{11}$/.test(g));

  return [...new Set(geoids)];
}

async function main() {
  let filePath = TMP_FILE;

  if (!existsSync(TMP_FILE) && !existsSync(TMP_FILE.replace(".xlsx", ".csv"))) {
    filePath = await tryDownload();
  } else {
    if (existsSync(TMP_FILE.replace(".xlsx", ".csv"))) {
      filePath = TMP_FILE.replace(".xlsx", ".csv");
    }
    console.log("Using existing file:", filePath);
  }

  const geoids = await parseFile(filePath);
  console.log(`Parsed ${geoids.length} Opportunity Zone tracts`);

  writeFileSync(OUT_FILE, JSON.stringify(geoids));
  console.log(`Written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
