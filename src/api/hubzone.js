/**
 * SBA HUBZone lookup
 * Endpoint: https://maps.certify.sba.gov/api/hubzone?lat=LAT&lng=LNG
 * Proxied via /api/hubzone-proxy (vite.config.js + vercel.json).
 *
 * Returns JSON. The `hubzone` array is non-empty if the location is designated.
 * Retries up to 3 times with a 1-second delay and a 10-second per-request timeout.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHubZone(lat, lon) {
  if (lat == null || lon == null) return { designated: false, checked: false };

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `/api/hubzone-proxy?lat=${lat}&lng=${lon}`,
        TIMEOUT_MS,
      );
      if (!res.ok) throw new Error(`SBA HUBZone API returned HTTP ${res.status}`);

      const data = await res.json();

      // Support both `{ hubzone: [...] }` and `{ designated: bool }` shapes
      let designated;
      if (typeof data?.designated === "boolean") {
        designated = data.designated;
      } else {
        designated = Array.isArray(data?.hubzone) && data.hubzone.length > 0;
      }

      return { designated, checked: true };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
      }
    }
  }

  // All attempts exhausted — return unavailable rather than throwing so
  // callers can display a clean "Unavailable" state without crashing the batch.
  console.warn("HUBZone check failed after", MAX_ATTEMPTS, "attempts:", lastError?.message);
  return { designated: false, checked: false, unavailable: true };
}
