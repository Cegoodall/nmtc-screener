/**
 * SBA HUBZone lookup
 * Endpoint: https://maps.certify.sba.gov/hubzone/map/search?latlng=LAT,LNG
 * Proxied via /api/hubzone-proxy (vite.config.js + vercel.json).
 *
 * The response is JavaScript (not JSON) with data embedded in a JSON.parse('...') call.
 * We extract the JSON string and parse it. The `hubzone` array is non-empty if designated.
 */
export async function checkHubZone(lat, lon) {
  if (lat == null || lon == null) return { designated: false, checked: false };

  const res = await fetch(`/api/hubzone-proxy?latlng=${lat},${lon}`);
  if (!res.ok) throw new Error(`SBA HUBZone API returned HTTP ${res.status}`);

  const text = await res.text();

  // Extract JSON from: JSON.parse('{ ... }')
  const match = text.match(/JSON\.parse\('(.+?)'\);/s);
  if (!match) throw new Error("Unexpected SBA HUBZone response format");

  // The JSON string uses escaped single quotes inside — unescape and parse
  const jsonStr = match[1].replace(/\\'/g, "'");
  const data = JSON.parse(jsonStr);

  const designated = Array.isArray(data?.hubzone) && data.hubzone.length > 0;

  return { designated, checked: true };
}
