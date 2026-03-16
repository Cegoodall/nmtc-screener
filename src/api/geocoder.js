/**
 * Geocoder with two-stage fallback:
 *
 * 1. Census Bureau address geocoder (most accurate, returns GEOID directly)
 * 2. Nominatim (OpenStreetMap) → lat/lon → Census coordinates-to-geography
 *
 * Both paths return the same shape: { matchedAddress, geoid, lat, lon, ... }
 * All endpoints are proxied to avoid CORS (vite.config.js + vercel.json).
 */

// ─── Stage 1: Census address geocoder ────────────────────────────────────────

async function tryCensusAddress(street, city, state, zip) {
  const params = new URLSearchParams({
    street, city, state,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  });
  if (zip) params.set("zip", zip);

  const res = await fetch(`/api/geocode?${params}`);
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);

  const data = await res.json();
  const matches = data?.result?.addressMatches;
  if (!matches?.length) return null;

  return parseCensusMatch(matches[0]);
}

function parseCensusMatch(match) {
  const tracts = match.geographies?.["Census Tracts"];
  if (!tracts?.length) return null;

  const t = tracts[0];
  const geoid = t.GEOID || `${t.STATE}${t.COUNTY}${t.TRACT}`;

  return {
    matchedAddress: match.matchedAddress,
    geoid,
    stateCode: t.STATE,
    countyCode: t.COUNTY,
    tractCode: t.TRACT,
    county: t.BASENAME || "",
    lat: match.coordinates?.y ?? null,
    lon: match.coordinates?.x ?? null,
    geocodedBy: "census",
  };
}

// ─── Stage 2a: Nominatim → lat/lon ───────────────────────────────────────────

async function tryNominatim(street, city, state, zip) {
  const q = [street, city, state, zip, "USA"].filter(Boolean).join(", ");
  const params = new URLSearchParams({
    q,
    format: "json",
    addressdetails: "1",
    countrycodes: "us",
    limit: "1",
  });

  const res = await fetch(`/api/nominatim/search?${params}`);
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const results = await res.json();
  if (!results?.length) return null;

  const r = results[0];
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name };
}

// ─── Stage 2b: FCC Census Block API → GEOID ──────────────────────────────────
// FCC supports browser CORS natively — no proxy needed.
// Block FIPS is 15 digits: state(2) + county(3) + tract(6) + block(4)
// Tract GEOID = first 11 digits.

async function fccCoordsToGeoid(lat, lon) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon, format: "json" });
  const res = await fetch(`https://geo.fcc.gov/api/census/block/find?${params}`);
  if (!res.ok) throw new Error(`FCC block API HTTP ${res.status}`);

  const data = await res.json();
  if (data?.status !== "OK" || !data?.Block?.FIPS) return null;

  const blockFips = String(data.Block.FIPS);
  const geoid     = blockFips.slice(0, 11).padStart(11, "0");
  const stateCode  = blockFips.slice(0, 2);
  const countyCode = blockFips.slice(2, 5);
  const tractCode  = blockFips.slice(5, 11);

  return {
    geoid,
    stateCode,
    countyCode,
    tractCode,
    county: data?.County?.name || "",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function geocodeAddress(street, city, state, zip = "") {
  // Stage 1: Census address geocoder
  const censusResult = await tryCensusAddress(street, city, state, zip);
  if (censusResult) return censusResult;

  // Stage 2: Nominatim → Census coordinates
  const nominatim = await tryNominatim(street, city, state, zip);
  if (!nominatim) {
    throw new Error(
      "Address not found. Check that the street address is correct and try including the ZIP code."
    );
  }

  const tractInfo = await fccCoordsToGeoid(nominatim.lat, nominatim.lon);
  if (!tractInfo) {
    throw new Error(
      "Address located but could not resolve to a census tract. The location may be outside US census coverage."
    );
  }

  return {
    matchedAddress: nominatim.displayName,
    geoid: tractInfo.geoid,
    stateCode: tractInfo.stateCode,
    countyCode: tractInfo.countyCode,
    tractCode: tractInfo.tractCode,
    county: tractInfo.county,
    lat: nominatim.lat,
    lon: nominatim.lon,
    geocodedBy: "nominatim",
  };
}
