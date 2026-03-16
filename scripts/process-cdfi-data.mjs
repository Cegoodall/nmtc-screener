/**
 * Download and convert CDFI Fund NMTC tract eligibility spreadsheet to JSON.
 * Output: public/cdfi-tracts.json — keyed by 11-digit GEOID
 *
 * Run: node scripts/process-cdfi-data.mjs
 *
 * Source: https://www.cdfifund.gov/programs-training/programs/new-markets-tax-credit/resources
 */

import { createWriteStream, readFileSync, writeFileSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP_FILE = path.join(ROOT, "scripts", "cdfi-raw.xlsb");
const OUT_FILE = path.join(ROOT, "public", "cdfi-tracts.json");

// Try multiple known URLs in order — CDFI Fund sometimes updates the path
const CDFI_URLS = [
  "https://www.cdfifund.gov/sites/cdfi/files/2024-08/NMTC_2011-2015_ACS_LIC_Sept2024.xlsx",
  "https://www.cdfifund.gov/sites/cdfi/files/documents/NMTC_2011-2015_ACS_LIC.xlsx",
  "https://www.cdfifund.gov/sites/cdfi/files/2023-12/NMTC_2016-2020_ACS_LIC_Dec2023.xlsx",
  "https://www.cdfifund.gov/sites/cdfi/files/2022-09/NMTCLICData_Sept2022.xlsx",
];

async function downloadFile(url, dest) {
  console.log(`Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body, ws);
  console.log(`Saved to: ${dest}`);
}

async function tryDownload() {
  for (const url of CDFI_URLS) {
    try {
      await downloadFile(url, TMP_FILE);
      return url;
    } catch (e) {
      console.warn(`Failed (${e.message}), trying next URL...`);
    }
  }
  throw new Error("All CDFI Fund URLs failed. Download manually and place at scripts/cdfi-raw.xlsx");
}

function normalizeKey(raw, headers) {
  // Find the key case-insensitively
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, "_");
  const match = headers.find(h => h.toLowerCase().replace(/[\s_-]+/g, "_") === lower);
  return match;
}

function parseSheet(XLSX) {
  const wb = XLSX.readFile(TMP_FILE);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

  if (!rows.length) throw new Error("Spreadsheet appears empty");

  const headers = Object.keys(rows[0]);
  console.log("Detected columns:", headers.slice(0, 20).join(", "));

  // Find a column by checking if the header contains any of the given substrings (case-insensitive, trimmed)
  function findCol(...fragments) {
    return headers.find(h => {
      const norm = h.toLowerCase().trim();
      return fragments.some(f => norm.includes(f.toLowerCase()));
    }) ?? null;
  }

  const colGeoid    = findCol("FIPS code. GEOID", "fips code. geoid", "geoid");
  const colPoverty  = findCol("Poverty Rate %", "poverty rate");
  const colMFI      = findCol("Percent of Benchmarked Median Family Income", "median family income (%)");
  const colUnemp    = findCol("Unemployment Rate (%)", "unemployment rate (%)");
  const colEligible = findCol("Qualify For NMTC Low-Income Community", "qualify for nmtc");
  const colSevere   = findCol("Severe distress", "severe_distress");
  const colDeep     = findCol("Deep distress", "deep_distress");
  const colHighMig  = findCol("High Migration", "high migration");
  const colName     = null; // not present in this file

  console.log("Column mappings:", { colGeoid, colPoverty, colMFI, colUnemp, colEligible, colName });

  if (!colGeoid) {
    // Print first row to help diagnose
    console.error("First row:", rows[0]);
    throw new Error("Cannot find GEOID column. Check column names above.");
  }

  const out = {};
  let count = 0;

  for (const row of rows) {
    let geoid = String(row[colGeoid] || "").trim().replace(/\.0$/, "");
    if (!geoid || geoid === "undefined") continue;

    // Pad to 11 digits
    geoid = geoid.padStart(11, "0");
    if (geoid.length !== 11) continue;

    const povertyRate = colPoverty ? parseFloat(row[colPoverty]) || 0 : 0;
    // MFI ratio in the file is a decimal (e.g. 1.037 = 103.7%) — convert to percentage
    const mfiRaw  = colMFI ? parseFloat(row[colMFI]) || 0 : 0;
    const mfiRatio = mfiRaw > 5 ? mfiRaw : mfiRaw * 100; // already % if > 5, else convert
    const unempRate = colUnemp ? parseFloat(row[colUnemp]) || 0 : 0;

    const yn = col => col ? String(row[col]).trim().toUpperCase() === "YES" : false;

    const eligible             = yn(colEligible);
    const povertyEligible      = yn(findCol("Qualify on Poverty Criteria", "qualify on poverty"));
    const incomeEligible       = yn(findCol("Qualify on Median Family Income Criteria", "qualify on median"));
    // Unemployment eligibility not a separate column — derive from rate
    const unemploymentEligible = unempRate >= 5.55;
    const severelyDistressed   = yn(colSevere);
    const deepDistress         = yn(colDeep);
    const highMigration        = yn(colHighMig);

    out[geoid] = {
      geoid,
      poverty_rate: povertyRate,
      mfi_ratio: Math.round(mfiRatio * 10) / 10,
      unemployment_rate: unempRate,
      eligible,
      poverty_eligible: povertyEligible,
      income_eligible: incomeEligible,
      unemployment_eligible: unemploymentEligible,
      severely_distressed: severelyDistressed,
      deep_distress: deepDistress,
      high_migration: highMigration,
    };
    count++;
  }

  return { data: out, count };
}

async function main() {
  // Skip download if file already exists
  if (!existsSync(TMP_FILE)) {
    await tryDownload();
  } else {
    console.log("Using existing file:", TMP_FILE);
  }

  // Dynamically import xlsx
  const XLSX = await import("xlsx").then(m => m.default || m);
  const { data, count } = parseSheet(XLSX);

  console.log(`Parsed ${count} tracts`);
  writeFileSync(OUT_FILE, JSON.stringify(data));
  console.log(`Written to ${OUT_FILE} (${Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)}KB)`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
