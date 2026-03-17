/**
 * Download and convert HRSA shortage area data to static JSON.
 * Output: public/hrsa-shortage.json — keyed by 5-digit county FIPS code
 *
 * Run: node scripts/process-hrsa-data.mjs
 *
 * Sources (HRSA Bureau of Health Workforce — no usage restrictions):
 *   HPSA PC: https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_PC.xlsx
 *   HPSA DH: https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_DH.xlsx
 *   HPSA MH: https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_MH.xlsx
 *   MUA:     https://data.hrsa.gov/DataDownload/DD_Files/MUA_DET.xlsx
 *
 * Data structure keyed by 5-digit county FIPS (e.g. "22071" = Orleans Parish, LA):
 *   {
 *     "_meta": { vintage, generated, hpsa_count, mua_count },
 *     "22071": {
 *       "pc": { score: 18, status: "Designated", name: "..." } | null,
 *       "dh": { score: 14, status: "Designated", name: "..." } | null,
 *       "mh": { score: 19, status: "Designated", name: "..." } | null,
 *       "mua": { imu_score: 52.1, status: "Designated", name: "..." } | null,
 *     }
 *   }
 *
 * HPSA type codes: PC = Primary Care, DH = Dental Health, MH = Mental Health
 * Only "Designated" status records are included (not Proposed for Withdrawal).
 * When multiple HPSAs of the same type cover one county, the highest score wins.
 */

import { createWriteStream, writeFileSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HPSA_PC_TMP = path.join(ROOT, "scripts", "hrsa-hpsa-pc-raw.xlsx");
const HPSA_DH_TMP = path.join(ROOT, "scripts", "hrsa-hpsa-dh-raw.xlsx");
const HPSA_MH_TMP = path.join(ROOT, "scripts", "hrsa-hpsa-mh-raw.xlsx");
const MUA_TMP     = path.join(ROOT, "scripts", "hrsa-mua-raw.xlsx");
const OUT_FILE    = path.join(ROOT, "public", "hrsa-shortage.json");

// HRSA periodically renames files; each entry is [dest, ...urlsToTry]
const HPSA_SOURCES = [
  { dest: HPSA_PC_TMP, type: "pc", urls: ["https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_PC.xlsx"] },
  { dest: HPSA_DH_TMP, type: "dh", urls: ["https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_DH.xlsx"] },
  { dest: HPSA_MH_TMP, type: "mh", urls: ["https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_MH.xlsx"] },
];
const MUA_URLS = [
  "https://data.hrsa.gov/DataDownload/DD_Files/MUA_DET.xlsx",
  "https://data.hrsa.gov/DataDownload/DD_Files/MU_DET.xlsx",
];

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadFile(urls, dest) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  for (const url of urlList) {
    console.log(`Downloading: ${url}`);
    const res = await fetch(url, {
      headers: { "User-Agent": "nmtc-screener-data-pipeline/1.0" },
    });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} — trying next URL...`);
      continue;
    }
    const ws = createWriteStream(dest);
    await pipeline(res.body, ws);
    console.log(`Saved: ${dest}`);
    return url;
  }
  throw new Error(`All URLs failed for ${dest}`);
}

// ─── Date helper ─────────────────────────────────────────────────────────────

// XLSX sometimes returns date cells as Excel serial numbers (days since 1899-12-30).
// Convert to ISO date string if numeric; pass strings through unchanged.
function normalizeDate(val) {
  if (!val && val !== 0) return "";
  const n = Number(val);
  if (!isNaN(n) && n > 1000) {
    // Excel epoch is Dec 30, 1899; Unix epoch is Jan 1, 1970 (25569 days later)
    return new Date((n - 25569) * 86400 * 1000).toISOString().slice(0, 10);
  }
  return String(val).trim();
}

// ─── Column detection helper ──────────────────────────────────────────────────

function findCol(headers, ...fragments) {
  return (
    headers.find(h => {
      const norm = h.toLowerCase().replace(/[\s_\-\/]+/g, "");
      return fragments.some(f => norm.includes(f.toLowerCase().replace(/[\s_\-\/]+/g, "")));
    }) ?? null
  );
}

// ─── HPSA processing ──────────────────────────────────────────────────────────

// forcedType: "pc" | "dh" | "mh" — used when the file doesn't have a type code column
function processHpsaFile(XLSX, filePath, forcedType) {
  console.log(`Parsing HPSA ${forcedType.toUpperCase()} file...`);
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!rows.length) throw new Error(`HPSA ${forcedType.toUpperCase()} file appears empty`);

  const headers = Object.keys(rows[0]);
  console.log(`HPSA ${forcedType.toUpperCase()} columns (first 15):`, headers.slice(0, 15).join(", "));

  // Flexible column mapping — HRSA has changed column names across releases
  const colName      = findCol(headers, "HPSAName", "HPSA Name", "Name");
  const colScore     = findCol(headers, "HPSAScore", "HPSA Score", "Score");
  const colStatus    = findCol(headers, "HPSAStatus", "HPSA Status", "Status");
  const colFips5     = findCol(headers, "CommonStateCountyFIPSCode", "Common State County FIPS", "FIPS Code", "CountyFIPS", "County FIPS");
  const colStateFips = findCol(headers, "PrimaryStateFIPSCode", "State FIPS Code", "CommonStateFIPS");
  const colCntyFips  = findCol(headers, "PrimaryCountyFIPSCode", "County FIPS Code", "CommonCountyFIPS");
  const colLastUpd   = findCol(headers, "HPSALastUpdateDate", "Last Update Date", "UpdateDate");

  console.log(`HPSA ${forcedType.toUpperCase()} column map:`, { colName, colScore, colStatus, colFips5, colStateFips, colCntyFips });

  if (colStatus) {
    const sampleStatuses = [...new Set(rows.slice(0, 200).map(r => String(r[colStatus] || "").trim()))].slice(0, 8);
    console.log(`HPSA ${forcedType.toUpperCase()} sample status values:`, sampleStatuses);
  } else {
    console.warn(`HPSA ${forcedType.toUpperCase()}: WARNING — status column not found, all rows will be skipped`);
  }

  if (!colFips5 && (!colStateFips || !colCntyFips)) {
    console.error("Available columns:", headers);
    throw new Error(`Cannot find county FIPS column(s) in HPSA ${forcedType.toUpperCase()} file. See column list above.`);
  }

  const lookup = {};
  let lastUpdateDate = "";
  let skipped = 0;

  for (const row of rows) {
    // Each file is already type-specific; no need to filter by type code column.
    // Use forcedType (derived from filename) as the output key.
    const status = String(row[colStatus] || "").trim();
    if (!status.toLowerCase().includes("designated") || status.toLowerCase().includes("proposed")) {
      skipped++;
      continue;
    }

    let fips5 = "";
    if (colFips5) {
      fips5 = String(row[colFips5] || "").trim().replace(/\.0$/, "").padStart(5, "0");
    } else {
      const sf = String(row[colStateFips] || "").trim().replace(/\.0$/, "").padStart(2, "0");
      const cf = String(row[colCntyFips] || "").trim().replace(/\.0$/, "").padStart(3, "0");
      fips5 = sf + cf;
    }
    if (!fips5 || fips5.length !== 5 || fips5 === "00000") continue;

    const score = colScore ? (parseInt(row[colScore], 10) || 0) : 0;
    const name  = colName  ? String(row[colName]  || "").trim() : "";
    const upd   = colLastUpd ? normalizeDate(row[colLastUpd]) : "";
    if (upd && upd > lastUpdateDate) lastUpdateDate = upd;

    const key = forcedType; // "pc" | "dh" | "mh"
    if (!lookup[fips5]) lookup[fips5] = {};
    const existing = lookup[fips5][key];
    if (!existing || score > existing.score) {
      lookup[fips5][key] = { score, status: "Designated", name };
    }
  }

  console.log(`HPSA ${forcedType.toUpperCase()}: processed ${Object.keys(lookup).length} counties, skipped ${skipped} non-designated rows`);
  return { lookup, lastUpdateDate };
}

// ─── MUA/P processing ─────────────────────────────────────────────────────────

function processMua(XLSX) {
  console.log("Parsing MUA/P file...");
  const wb = XLSX.readFile(MUA_TMP);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!rows.length) throw new Error("MUA file appears empty");

  const headers = Object.keys(rows[0]);


  const colName       = findCol(headers, "ServiceAreaName", "DesignationName", "Designation Name", "Name");
  const colType       = findCol(headers, "DesignationTypeCode", "Designation Type Code", "DesignationType", "Designation Type");
  // Avoid "Status" alone — it matches "MUA/P Status Code" (values: D/W/P) before "MUA/P Status Description"
  const colStatus     = findCol(headers, "MUAPStatusDescription", "StatusDescription", "DesignationStatus");
  const colImu        = findCol(headers, "IMUScore", "IMU Score", "IndexOfMedical", "IMU");
  // "FIPS Code" alone matches "State FIPS Code" (2-digit) before "Common State County FIPS Code" (5-digit)
  // Use county-specific fragments that won't match "State FIPS Code"
  const colFips5      = findCol(headers, "CommonStateCountyFIPSCode", "Common State County FIPS", "CountyFIPS", "County FIPS");
  const colStateFips  = findCol(headers, "PrimaryStateFIPSCode", "State FIPS Code", "CommonStateFIPS");
  const colCntyFips   = findCol(headers, "PrimaryCountyFIPSCode", "County FIPS Code", "CommonCountyFIPS");
  const colLastUpd    = findCol(headers, "DesignationLastUpdateDate", "Last Update Date", "UpdateDate");

  if (!colFips5 && (!colStateFips || !colCntyFips)) {
    console.error("Available columns:", headers);
    throw new Error("Cannot find county FIPS column(s) in MUA file. See column list above.");
  }

  console.log("MUA column map:", { colName, colType, colStatus, colImu, colFips5, colStateFips, colCntyFips });

  if (colStatus) {
    const sampleStatuses = [...new Set(rows.slice(0, 200).map(r => String(r[colStatus] || "").trim()))].slice(0, 8);
    console.log("MUA sample status values:", sampleStatuses);
  } else {
    console.warn("MUA: WARNING — status column not found, all rows will be skipped");
  }

  const lookup = {};
  let lastUpdateDate = "";
  let skipped = 0;

  for (const row of rows) {
    const status = String(row[colStatus] || "").trim();
    const sl = status.toLowerCase();
    // Accept "Designated" (description column) or "D" (status code column)
    const isDesignated = sl === "d" || (sl.includes("designated") && !sl.includes("proposed"));
    if (!isDesignated) {
      skipped++;
      continue;
    }

    let fips5 = "";
    if (colFips5) {
      fips5 = String(row[colFips5] || "").trim().replace(/\.0$/, "").padStart(5, "0");
    } else {
      const sf = String(row[colStateFips] || "").trim().replace(/\.0$/, "").padStart(2, "0");
      const cf = String(row[colCntyFips]  || "").trim().replace(/\.0$/, "").padStart(3, "0");
      fips5 = sf + cf;
    }
    if (!fips5 || fips5.length !== 5 || fips5 === "00000") continue;

    const rawType   = String(row[colType] || "").trim().toUpperCase();
    const isMua     = rawType.includes("MUA") || rawType === "A" || rawType === "M";
    const isMup     = rawType.includes("MUP") || rawType === "P";
    if (!isMua && !isMup) continue;

    const imuScore  = colImu  ? (parseFloat(row[colImu])  || null) : null;
    const name      = colName ? String(row[colName] || "").trim() : "";
    const upd       = colLastUpd ? String(row[colLastUpd] || "").trim() : "";
    if (upd && upd > lastUpdateDate) lastUpdateDate = upd;

    const key = isMua ? "mua" : "mup";
    if (!lookup[fips5]) lookup[fips5] = {};
    const existing = lookup[fips5][key];
    if (!existing || (imuScore !== null && imuScore < (existing.imu_score ?? 100))) {
      lookup[fips5][key] = { imu_score: imuScore, status: "Designated", name };
    }
  }

  console.log(`MUA/P: processed ${Object.keys(lookup).length} counties, skipped ${skipped} non-designated rows`);
  return { lookup, lastUpdateDate };
}

// ─── Merge + output ───────────────────────────────────────────────────────────

function merge(hpsaResults, muaResult) {
  const out = {};

  // Merge all HPSA type lookups
  const hpsaLookup = {};
  for (const { lookup } of hpsaResults) {
    for (const [fips5, types] of Object.entries(lookup)) {
      if (!hpsaLookup[fips5]) hpsaLookup[fips5] = {};
      Object.assign(hpsaLookup[fips5], types);
    }
  }

  const allFips = new Set([
    ...Object.keys(hpsaLookup),
    ...Object.keys(muaResult.lookup),
  ]);

  for (const fips5 of allFips) {
    const h = hpsaLookup[fips5] ?? {};
    const m = muaResult.lookup[fips5] ?? {};
    out[fips5] = {
      pc:  h.pc  ?? null,
      dh:  h.dh  ?? null,
      mh:  h.mh  ?? null,
      mua: m.mua ?? null,
      mup: m.mup ?? null,
    };
  }

  let hpsaCount = 0;
  let muaCount  = 0;
  for (const v of Object.values(out)) {
    if (v.pc || v.dh || v.mh) hpsaCount++;
    if (v.mua || v.mup) muaCount++;
  }

  const dates = [
    ...hpsaResults.map(r => r.lastUpdateDate),
    muaResult.lastUpdateDate,
  ].filter(Boolean);
  const vintage = dates.length
    ? `HRSA HPSA/MUA data — last record update ${dates.sort().pop()}`
    : `HRSA HPSA/MUA data — downloaded ${new Date().toISOString().slice(0, 10)}`;

  out._meta = {
    vintage,
    generated: new Date().toISOString(),
    hpsa_counties_with_designation: hpsaCount,
    mua_counties_with_designation: muaCount,
    source_hpsa_pc: HPSA_SOURCES[0].urls[0],
    source_hpsa_dh: HPSA_SOURCES[1].urls[0],
    source_hpsa_mh: HPSA_SOURCES[2].urls[0],
    source_mua: MUA_URLS[0],
  };

  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Download HPSA files if not already present
  for (const { dest, urls, type } of HPSA_SOURCES) {
    if (!existsSync(dest)) {
      await downloadFile(urls, dest);
    } else {
      console.log(`Using cached HPSA ${type.toUpperCase()} file:`, dest);
    }
  }

  if (!existsSync(MUA_TMP)) {
    await downloadFile(MUA_URLS, MUA_TMP);
  } else {
    console.log("Using cached MUA file:", MUA_TMP);
  }

  const XLSX = await import("xlsx").then(m => m.default || m);

  const hpsaResults = HPSA_SOURCES.map(({ dest, type }) =>
    processHpsaFile(XLSX, dest, type)
  );
  const muaResult = processMua(XLSX);
  const merged    = merge(hpsaResults, muaResult);

  writeFileSync(OUT_FILE, JSON.stringify(merged));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(merged)) / 1024);
  console.log(`\nWritten: ${OUT_FILE} (${kb} KB)`);
  console.log(`Counties with any HPSA: ${merged._meta.hpsa_counties_with_designation}`);
  console.log(`Counties with MUA/MUP:  ${merged._meta.mua_counties_with_designation}`);
  console.log(`Vintage: ${merged._meta.vintage}`);
  console.log("\nTo refresh data, delete the cached raw files and re-run:");
  console.log(`  rm ${HPSA_PC_TMP} ${HPSA_DH_TMP} ${HPSA_MH_TMP} ${MUA_TMP} && node scripts/process-hrsa-data.mjs`);
}

main().catch(e => {
  console.error("\n✗ Error:", e.message);
  console.error("\nIf the download failed, manually download the files to:");
  for (const { dest, urls } of HPSA_SOURCES) {
    console.error(`  ${dest}  <-  ${urls[0]}`);
  }
  console.error(`  ${MUA_TMP}  <-  ${MUA_URLS[0]}`);
  process.exit(1);
});
