/**
 * Address validation script
 * Runs 10 test addresses through the same geocoding pipeline as the app,
 * pulls CDFI Fund tract data, and outputs results for CIMS comparison.
 *
 * Run: node scripts/validate-addresses.mjs
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tractData = JSON.parse(readFileSync(path.join(__dirname, "../public/cdfi-tracts.json"), "utf8"));
const ozSet = new Set(JSON.parse(readFileSync(path.join(__dirname, "../public/oz-tracts.json"), "utf8")));

const TEST_ADDRESSES = [
  // Louisiana — urban, Deep Distress
  { street: "2400 Tulane Ave",         city: "New Orleans",  state: "LA", zip: "70119", scenario: "LA urban / Deep Distress candidate" },
  // Louisiana — rural
  { street: "100 W Main St",           city: "Ferriday",     state: "LA", zip: "71334", scenario: "LA rural / small town" },
  // Illinois — Deep Distress (Chicago South Side)
  { street: "1400 E 71st St",          city: "Chicago",      state: "IL", zip: "60619", scenario: "IL urban / Deep Distress candidate" },
  // Illinois — ineligible suburb
  { street: "100 Central Ave",         city: "Highland Park", state: "IL", zip: "60035", scenario: "IL suburban / likely ineligible" },
  // Florida — urban eligible
  { street: "1000 NW 95th St",         city: "Miami",        state: "FL", zip: "33150", scenario: "FL urban / eligible candidate" },
  // Florida — rural
  { street: "115 NW 5th Ave",          city: "Jasper",       state: "FL", zip: "32052", scenario: "FL rural / small county" },
  // Alabama — urban
  { street: "710 S 20th St",           city: "Birmingham",   state: "AL", zip: "35233", scenario: "AL urban / hospital district" },
  // Alabama — rural Black Belt
  { street: "100 Broad St",            city: "Selma",        state: "AL", zip: "36701", scenario: "AL rural / Black Belt" },
  // Boundary edge case — campus address (known CIMS mismatch)
  { street: "1 Drexel Drive",          city: "New Orleans",  state: "LA", zip: "70125", scenario: "BOUNDARY — known CIMS mismatch test" },
  // Ineligible affluent tract
  { street: "1 Buckhead Ave NE",       city: "Atlanta",      state: "GA", zip: "30305", scenario: "GA affluent / likely ineligible" },
];

// ─── Geocoding pipeline (mirrors app logic) ───────────────────────────────────

async function tryCensusAddress(street, city, state, zip) {
  const params = new URLSearchParams({
    street, city, state, zip,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  const res = await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/address?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const m = data?.result?.addressMatches;
  if (!m?.length) return null;
  const match = m[0];
  const t = match.geographies?.["Census Tracts"]?.[0];
  if (!t) return null;
  return {
    geoid: t.GEOID || `${t.STATE}${t.COUNTY}${t.TRACT}`,
    lat: match.coordinates?.y, lon: match.coordinates?.x,
    matchedAddress: match.matchedAddress,
    source: "census-address",
  };
}

async function tryNominatim(street, city, state, zip) {
  const q = [street, city, state, zip, "USA"].filter(Boolean).join(", ");
  const params = new URLSearchParams({ q, format: "json", countrycodes: "us", limit: "1" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": "NMTC-Screener-Validator/1.0" },
  });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results?.length) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), displayName: results[0].display_name };
}

async function fccToGeoid(lat, lon) {
  const res = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lon}&format=json`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data?.status !== "OK" || !data?.Block?.FIPS) return null;
  const fips = String(data.Block.FIPS);
  return {
    geoid: fips.slice(0, 11).padStart(11, "0"),
    lat, lon,
    source: "nominatim+fcc",
    matchedAddress: null,
  };
}

async function geocode(street, city, state, zip) {
  const census = await tryCensusAddress(street, city, state, zip);
  if (census) return census;
  await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit
  const nom = await tryNominatim(street, city, state, zip);
  if (!nom) return null;
  const fcc = await fccToGeoid(nom.lat, nom.lon);
  if (!fcc) return null;
  return { ...fcc, matchedAddress: nom.displayName };
}

// ─── CDFI tract lookup ────────────────────────────────────────────────────────

function lookupTract(geoid) {
  return tractData[geoid] ?? tractData[String(geoid).padStart(11, "0")] ?? null;
}

function distressTier(tract) {
  if (!tract?.eligible) return "INELIGIBLE";
  if (tract.deep_distress) return "DEEP DISTRESS";
  if (tract.severely_distressed) return "SEVERELY DISTRESSED";
  return "ELIGIBLE LIC";
}

// ─── CIMS lookup attempt ──────────────────────────────────────────────────────
// CIMS v4 at cims.cdfifund.gov — try to resolve GEOID from their public geocoder

async function tryCIMS(street, city, state, zip) {
  // CIMS uses an Esri geocoding service. Try their public-facing API if accessible.
  // Most CIMS functionality requires a session — we try the public tract lookup endpoint.
  try {
    const addr = `${street}, ${city}, ${state} ${zip}`;
    const params = new URLSearchParams({
      SingleLine: addr,
      f: "json",
      outFields: "Addr_type,score",
      maxLocations: 1,
    });
    const res = await fetch(
      `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const candidate = data?.candidates?.[0];
    if (!candidate || candidate.score < 80) return null;

    const { x: lon, y: lat } = candidate.location;

    // Now get the census tract from FCC using Esri's coordinates
    const fcc = await fccToGeoid(lat, lon);
    return fcc ? { geoid: fcc.geoid, lat, lon, score: candidate.score, address: candidate.address } : null;
  } catch {
    return null;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const PAD = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
const COL = 28;

async function main() {
  console.log("\nNMTC Screener — Address Validation Report");
  console.log("==========================================");
  console.log(`Run date: ${new Date().toISOString()}\n`);
  console.log(`${"Address".padEnd(38)} ${"Scenario".padEnd(35)} ${"App GEOID".padEnd(13)} ${"CIMS GEOID".padEnd(13)} Match  Tier                 OZ    Poverty  MFI    Unemp`);
  console.log("─".repeat(160));

  const rows = [];

  for (const addr of TEST_ADDRESSES) {
    const label = `${addr.street}, ${addr.city}, ${addr.state}`;
    process.stdout.write(`  Geocoding: ${label}...`);

    let appGeoid = null, appSource = null, lat = null, lon = null, matchedAddr = null;
    let cimsGeoid = null, cimsScore = null;

    try {
      const geo = await geocode(addr.street, addr.city, addr.state, addr.zip);
      if (geo) {
        appGeoid = geo.geoid;
        appSource = geo.source;
        lat = geo.lat;
        lon = geo.lon;
        matchedAddr = geo.matchedAddress;
      }
    } catch (e) {
      appGeoid = `ERROR: ${e.message}`;
    }

    // Try CIMS/Esri geocoder for comparison
    try {
      await new Promise(r => setTimeout(r, 500));
      const cims = await tryCIMS(addr.street, addr.city, addr.state, addr.zip);
      if (cims) {
        cimsGeoid = cims.geoid;
        cimsScore = cims.score;
      }
    } catch {}

    const tract = appGeoid ? lookupTract(appGeoid) : null;
    const tier = distressTier(tract);
    const oz = appGeoid ? ozSet.has(appGeoid) : false;
    const match = appGeoid && cimsGeoid
      ? (appGeoid === cimsGeoid ? "✓ YES" : "✗ NO ")
      : (appGeoid ? "??" : "FAIL");

    rows.push({
      address: label,
      scenario: addr.scenario,
      appGeoid: appGeoid || "FAIL",
      appSource,
      cimsGeoid: cimsGeoid || "unavailable",
      cimsScore,
      match,
      tier,
      oz,
      povertyRate: tract?.poverty_rate ?? "—",
      mfiRatio: tract?.mfi_ratio ?? "—",
      unemploymentRate: tract?.unemployment_rate ?? "—",
      matchedAddr,
    });

    const tractStr = tract ? `${tier.padEnd(20)} ${String(oz).padEnd(5)} ${String(tract.poverty_rate ?? "—").padEnd(8)} ${String(tract.mfi_ratio ?? "—").padEnd(6)} ${tract.unemployment_rate ?? "—"}` : "NOT IN CDFI DATA";
    console.log(`\r${PAD(label, 38)} ${PAD(addr.scenario, 35)} ${PAD(appGeoid, 13)} ${PAD(cimsGeoid || "unavail", 13)} ${match}  ${tractStr}`);

    await new Promise(r => setTimeout(r, 800)); // be polite to APIs
  }

  console.log("\n─".repeat(160));
  console.log("\nSUMMARY");
  console.log("───────");

  const matched = rows.filter(r => r.match === "✓ YES").length;
  const mismatched = rows.filter(r => r.match === "✗ NO ").length;
  const unknown = rows.filter(r => r.match === "??" || r.match === "FAIL").length;

  console.log(`  Total addresses tested:  ${rows.length}`);
  console.log(`  GEOID matches with CIMS: ${matched}`);
  console.log(`  GEOID mismatches:        ${mismatched}`);
  console.log(`  CIMS unavailable/FAIL:   ${unknown}`);

  if (mismatched > 0) {
    console.log("\nMISMATCHES — Investigate:");
    rows.filter(r => r.match === "✗ NO ").forEach(r => {
      console.log(`  ⚠ ${r.address}`);
      console.log(`      App GEOID:  ${r.appGeoid} (via ${r.appSource})`);
      console.log(`      CIMS GEOID: ${r.cimsGeoid} (Esri score: ${r.cimsScore})`);
    });
  }

  console.log("\nGEOCODER SOURCE BREAKDOWN:");
  const sources = {};
  rows.forEach(r => { sources[r.appSource] = (sources[r.appSource] || 0) + 1; });
  Object.entries(sources).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\nTIER BREAKDOWN:");
  const tiers = {};
  rows.forEach(r => { tiers[r.tier] = (tiers[r.tier] || 0) + 1; });
  Object.entries(tiers).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log("\nNOTE: CIMS column uses Esri ArcGIS geocoder + FCC tract assignment as a proxy for CIMS.");
  console.log("      For definitive CIMS verification, manually check each GEOID at cims.cdfifund.gov.\n");
}

main().catch(console.error);
