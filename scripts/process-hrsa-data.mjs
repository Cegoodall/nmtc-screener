/**
 * Download and convert HRSA shortage area data to static JSON.
 * Output: public/hrsa-shortage.json — keyed by 5-digit county FIPS code
 *
 * Run: node scripts/process-hrsa-data.mjs
 *
 * Sources (HRSA Bureau of Health Workforce — no usage restrictions):
 *   HPSA: https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_DL.xlsx
 *   MUA:  https://data.hrsa.gov/DataDownload/DD_Files/MUA_DET.xlsx
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

import { createWriteStream, writeFileSync, existsSync, unlinkSync } from "fs";
import { pipeline } from "stream/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HPSA_TMP = path.join(ROOT, "scripts", "hrsa-hpsa-raw.xlsx");
const MUA_TMP  = path.join(ROOT, "scripts", "hrsa-mua-raw.xlsx");
const OUT_FILE = path.join(ROOT, "public", "hrsa-shortage.json");

const HPSA_URL = "https://data.hrsa.gov/DataDownload/DD_Files/BCD_HPSA_FCT_DET_DL.xlsx";
const MUA_URL  = "https://data.hrsa.gov/DataDownload/DD_Files/MUA_DET.xlsx";

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadFile(url, dest) {
  console.log(`Downloading: ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": "nmtc-screener-data-pipeline/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body, ws);
  console.log(`Saved: ${dest}`);
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

function processHpsa(XLSX) {
  console.log("Parsing HPSA file...");
  const wb = XLSX.readFile(HPSA_TMP);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!rows.length) throw new Error("HPSA file appears empty");

  const headers = Object.keys(rows[0]);
  console.log("HPSA columns:", headers.slice(0, 15).join(", "));

  // Flexible column mapping — HRSA has changed column names across releases
  const colName      = findCol(headers, "HPSAName", "HPSA Name", "Name");
  const colTypeCode  = findCol(headers, "HPSATypeCode", "HPSA Type Code", "Type Code");
  const colScore     = findCol(headers, "HPSAScore", "HPSA Score", "Score");
  const colStatus    = findCol(headers, "HPSAStatus", "HPSA Status", "Status");
  const colFips5     = findCol(headers, "CommonStateCountyFIPSCode", "Common State County FIPS", "FIPS Code", "CountyFIPS", "County FIPS");
  const colStateFips = findCol(headers, "PrimaryStateFIPSCode", "State FIPS Code", "CommonStateFIPS");
  const colCntyFips  = findCol(headers, "PrimaryCountyFIPSCode", "County FIPS Code", "CommonCountyFIPS");
  const colLastUpd   = findCol(headers, "HPSALastUpdateDate", "Last Update Date", "UpdateDate");

  if (!colTypeCode) {
    console.error("Available columns:", headers);
    throw new Error("Cannot find HPSA Type Code column. See column list above.");
  }
  if (!colFips5 && (!colStateFips || !colCntyFips)) {
    console.error("Available columns:", headers);
    throw new Error("Cannot find county FIPS column(s). See column list above.");
  }

  console.log("HPSA column map:", { colName, colTypeCode, colScore, colStatus, colFips5, colStateFips, colCntyFips });

  // Build lookup: fips5 → { pc, dh, mh } taking highest score per type
  const lookup = {};
  let lastUpdateDate = "";
  let skipped = 0;

  for (const row of rows) {
    const typeCode = String(row[colTypeCode] || "").trim().toUpperCase();
    if (!["PC", "DH", "MH"].includes(typeCode)) continue;

    const status = String(row[colStatus] || "").trim();
    // Only include "Designated" records — skip Proposed for Withdrawal, Not Designated, etc.
    if (!status.toLowerCase().includes("designated") || status.toLowerCase().includes("proposed")) {
      skipped++;
      continue;
    }

    // Resolve 5-digit county FIPS
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
    const upd   = colLastUpd ? String(row[colLastUpd] || "").trim() : "";
    if (upd && upd > lastUpdateDate) lastUpdateDate = upd;

    const key = typeCode.toLowerCase(); // "pc" | "dh" | "mh"
    if (!lookup[fips5]) lookup[fips5] = {};
    const existing = lookup[fips5][key];
    if (!existing || score > existing.score) {
      lookup[fips5][key] = { score, status: "Designated", name };
    }
  }

  console.log(`HPSA: processed ${Object.keys(lookup).length} counties, skipped ${skipped} non-designated rows`);
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
  console.log("MUA columns:", headers.slice(0, 15).join(", "));

  const colName       = findCol(headers, "DesignationName", "Designation Name", "Name");
  const colType       = findCol(headers, "DesignationType", "Designation Type", "Type");
  const colStatus     = findCol(headers, "DesignationStatus", "Designation Status", "Status");
  const colImu        = findCol(headers, "IMUScore", "IMU Score", "IndexOfMedical", "IMU");
  const colFips5      = findCol(headers, "CommonStateCountyFIPSCode", "Common State County FIPS", "FIPS Code", "CountyFIPS");
  const colStateFips  = findCol(headers, "PrimaryStateFIPSCode", "State FIPS Code", "CommonStateFIPS");
  const colCntyFips   = findCol(headers, "PrimaryCountyFIPSCode", "County FIPS Code", "CommonCountyFIPS");
  const colLastUpd    = findCol(headers, "DesignationLastUpdateDate", "Last Update Date", "UpdateDate");

  if (!colFips5 && (!colStateFips || !colCntyFips)) {
    console.error("Available columns:", headers);
    throw new Error("Cannot find county FIPS column(s) in MUA file. See column list above.");
  }

  console.log("MUA column map:", { colName, colType, colStatus, colImu, colFips5 });

  const lookup = {};
  let lastUpdateDate = "";
  let skipped = 0;

  for (const row of rows) {
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
    // Keep first designation found per type (or lowest IMU = greatest underservice)
    const existing = lookup[fips5][key];
    if (!existing || (imuScore !== null && imuScore < (existing.imu_score ?? 100))) {
      lookup[fips5][key] = { imu_score: imuScore, status: "Designated", name };
    }
  }

  console.log(`MUA/P: processed ${Object.keys(lookup).length} counties, skipped ${skipped} non-designated rows`);
  return { lookup, lastUpdateDate };
}

// ─── Merge + output ───────────────────────────────────────────────────────────

function merge(hpsaResult, muaResult) {
  const out = {};
  const allFips = new Set([
    ...Object.keys(hpsaResult.lookup),
    ...Object.keys(muaResult.lookup),
  ]);

  for (const fips5 of allFips) {
    const h = hpsaResult.lookup[fips5] ?? {};
    const m = muaResult.lookup[fips5] ?? {};
    out[fips5] = {
      pc:  h.pc  ?? null,
      dh:  h.dh  ?? null,
      mh:  h.mh  ?? null,
      mua: m.mua ?? null,
      mup: m.mup ?? null,
    };
  }

  // Count active designations for meta
  let hpsaCount = 0;
  let muaCount  = 0;
  for (const v of Object.values(out)) {
    if (v.pc || v.dh || v.mh) hpsaCount++;
    if (v.mua || v.mup) muaCount++;
  }

  // Build vintage string from last-update dates
  const dates = [hpsaResult.lastUpdateDate, muaResult.lastUpdateDate].filter(Boolean);
  const vintage = dates.length
    ? `HRSA HPSA/MUA data — last record update ${dates.sort().pop()}`
    : `HRSA HPSA/MUA data — downloaded ${new Date().toISOString().slice(0, 10)}`;

  out._meta = {
    vintage,
    generated: new Date().toISOString(),
    hpsa_counties_with_designation: hpsaCount,
    mua_counties_with_designation: muaCount,
    source_hpsa: HPSA_URL,
    source_mua: MUA_URL,
  };

  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Download files if not already present
  if (!existsSync(HPSA_TMP)) {
    await downloadFile(HPSA_URL, HPSA_TMP);
  } else {
    console.log("Using cached HPSA file:", HPSA_TMP);
  }

  if (!existsSync(MUA_TMP)) {
    await downloadFile(MUA_URL, MUA_TMP);
  } else {
    console.log("Using cached MUA file:", MUA_TMP);
  }

  const XLSX = await import("xlsx").then(m => m.default || m);
  const hpsaResult = processHpsa(XLSX);
  const muaResult  = processMua(XLSX);
  const merged     = merge(hpsaResult, muaResult);

  writeFileSync(OUT_FILE, JSON.stringify(merged));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(merged)) / 1024);
  console.log(`\nWritten: ${OUT_FILE} (${kb} KB)`);
  console.log(`Counties with any HPSA: ${merged._meta.hpsa_counties_with_designation}`);
  console.log(`Counties with MUA/MUP:  ${merged._meta.mua_counties_with_designation}`);
  console.log(`Vintage: ${merged._meta.vintage}`);
  console.log("\nTo refresh data, delete the cached raw files and re-run:");
  console.log(`  rm ${HPSA_TMP} ${MUA_TMP} && node scripts/process-hrsa-data.mjs`);
}

main().catch(e => {
  console.error("\n✗ Error:", e.message);
  console.error("\nIf the download failed, manually download the files to:");
  console.error(`  ${HPSA_TMP}`);
  console.error(`  ${MUA_TMP}`);
  console.error("from:");
  console.error(`  ${HPSA_URL}`);
  console.error(`  ${MUA_URL}`);
  process.exit(1);
});
