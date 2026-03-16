/**
 * Treasury Opportunity Zone tract lookup.
 * The bundled JSON (public/oz-tracts.json) is an array of GEOID strings.
 */

let ozSet = null;
let loadPromise = null;

async function loadOZData() {
  if (ozSet) return ozSet;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/oz-tracts.json")
    .then(r => {
      if (!r.ok) throw new Error(`Failed to load OZ tract data: HTTP ${r.status}`);
      return r.json();
    })
    .then(arr => {
      ozSet = new Set(arr.map(String));
      return ozSet;
    });

  return loadPromise;
}

export function isOpportunityZone(geoid) {
  if (!ozSet) return false;
  return ozSet.has(String(geoid)) || ozSet.has(String(geoid).padStart(11, "0"));
}

export async function preloadOZData() {
  return loadOZData();
}
