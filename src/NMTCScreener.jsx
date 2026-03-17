import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { geocodeAddress } from "./api/geocoder";
import { lookupTract, preloadTractData } from "./data/tractLookup";
import { isOpportunityZone, preloadOZData } from "./data/ozLookup";
import {
  lookupHrsaByCounty,
  lookupHrsaByFips5,
  isHrsaDataPopulated,
  getHrsaVintage,
  preloadHrsaData,
} from "./data/hrsaLookup";
import { checkHubZone } from "./api/hubzone";
import { logSearch } from "./data/searchHistory";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

// ─── Tier logic ──────────────────────────────────────────────────────────────

function computeTier(r) {
  if (!r || !r.eligible) return "ineligible";
  if (r.deepDistress) return "deep";
  if (r.severelyDistressed || r.hubZone?.designated) return "severe";
  return "lic";
}

const TIER_CONFIG = {
  ineligible: { label: "Does Not Meet LIC Criteria", color: "#64748b", bg: "linear-gradient(135deg,#1e293b,#334155)", badge: null },
  lic:        { label: "Eligible Low-Income Community", color: "#16a34a", bg: "linear-gradient(135deg,#14532d,#166534)", badge: "TIER 1 — LIC" },
  severe:     { label: "Eligible — Severely Distressed", color: "#d97706", bg: "linear-gradient(135deg,#78350f,#92400e)", badge: "TIER 2 — SEVERELY DISTRESSED" },
  deep:       { label: "Eligible — Deep Distress", color: "#dc2626", bg: "linear-gradient(135deg,#7f1d1d,#991b1b)", badge: "TIER 3 — DEEP DISTRESS" },
};

// ─── Small UI atoms ───────────────────────────────────────────────────────────

function Chip({ label, color = "rgba(34,197,94,0.15)", textColor = "#dcfce7", borderColor = "rgba(34,197,94,0.4)" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      letterSpacing: 0.5, textTransform: "uppercase",
      background: color, color: textColor, border: `1px solid ${borderColor}`,
    }}>
      <span style={{ fontSize: 9 }}>●</span> {label}
    </span>
  );
}

function MetricCard({ label, value, sub, threshold, met, note }) {
  return (
    <div style={{
      background: met ? "rgba(34,197,94,0.04)" : "white",
      border: `1px solid ${met ? "rgba(34,197,94,0.3)" : "#e2e8f0"}`,
      borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      {met && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#16a34a,#22c55e)" }} />}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: met ? "#16a34a" : "#0f172a", fontFamily: "monospace", lineHeight: 1, letterSpacing: -1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{sub}</div>}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: met ? "#16a34a" : "#94a3b8", fontWeight: 700 }}>
          {met ? "✓ MEETS THRESHOLD" : "✗ BELOW THRESHOLD"}
        </div>
        <div style={{ fontSize: 10, color: "#cbd5e1" }}>{threshold}</div>
      </div>
      {note && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>{note}</div>}
    </div>
  );
}

function StatusCard({ label, designated, icon, color, description, note }) {
  return (
    <div style={{
      background: designated ? `${color}08` : "white",
      border: `1px solid ${designated ? `${color}40` : "#e2e8f0"}`,
      borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      {designated && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color }} />}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: designated ? color : "#94a3b8", fontFamily: "monospace", lineHeight: 1, marginBottom: 8 }}>
        {icon} {designated ? "YES" : "NO"}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{description}</div>
      {note && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>{note}</div>}
    </div>
  );
}

// ─── Deep Distress detail panel ───────────────────────────────────────────────

function DeepDistressBanner({ basis, highMigration }) {
  const labels = {
    poverty_rate_40: "Poverty rate > 40%",
    mfi_40: "MFI ≤ 40% of area median",
    unemployment_2_5x: "Unemployment ≥ 2.5× national average",
  };
  return (
    <div style={{
      background: "rgba(220,38,38,0.06)", border: "1.5px solid rgba(220,38,38,0.35)",
      borderRadius: 10, padding: "16px 20px", marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{
          background: "#dc2626", color: "white", padding: "3px 10px",
          borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
        }}>
          DEEP DISTRESS — 2025 Application Cycle
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#7f1d1d", fontWeight: 600, marginBottom: 6 }}>
        This tract qualifies for Deep Distress designation — CDEs committing ≥ 20% of QLICIs here may receive a scoring boost in the CDFI Fund allocation application.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {basis.map(b => (
          <span key={b} style={{
            background: "rgba(220,38,38,0.12)", color: "#dc2626",
            border: "1px solid rgba(220,38,38,0.3)", borderRadius: 4,
            padding: "2px 9px", fontSize: 11, fontWeight: 700,
          }}>
            {labels[b] || b}
          </span>
        ))}
        {highMigration && (
          <span style={{
            background: "rgba(220,38,38,0.08)", color: "#b91c1c",
            border: "1px solid rgba(220,38,38,0.2)", borderRadius: 4,
            padding: "2px 9px", fontSize: 11, fontWeight: 700, fontStyle: "italic",
          }}>
            High-Migration Rural County (verify with CDFI Fund)
          </span>
        )}
      </div>
    </div>
  );
}

// ─── HRSA shortage area panel ─────────────────────────────────────────────────

function HrsaDesignationBadge({ label, data, scoreLabel }) {
  const designated = !!data;
  const color = designated ? "#0d9488" : null; // teal for positive designations
  return (
    <div style={{
      background: designated ? "rgba(13,148,136,0.05)" : "#f8fafc",
      border: `1px solid ${designated ? "rgba(13,148,136,0.3)" : "#e2e8f0"}`,
      borderRadius: 8, padding: "12px 14px", position: "relative", overflow: "hidden",
      flex: "1 1 0", minWidth: 0,
    }}>
      {designated && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color }} />
      )}
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.3, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      {designated ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 800, color, marginBottom: 4 }}>Designated</div>
          {data.score != null && (
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 2 }}>
              {scoreLabel}: <strong style={{ fontFamily: "monospace" }}>{data.score}</strong>
              <span style={{ color: "#94a3b8", marginLeft: 4 }}>(higher = greater need)</span>
            </div>
          )}
          {data.imu_score != null && (
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 2 }}>
              IMU score: <strong style={{ fontFamily: "monospace" }}>{data.imu_score.toFixed(1)}</strong>
              <span style={{ color: "#94a3b8", marginLeft: 4 }}>({"<"}62 = underserved)</span>
            </div>
          )}
          {data.name && (
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 3, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {data.name}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>Not designated</div>
      )}
    </div>
  );
}

function HrsaPanel({ hrsa, countyFips5, dataPopulated, vintage }) {
  if (!dataPopulated) {
    return (
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 10,
        padding: "16px 20px", marginBottom: 12,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 6 }}>
            MUA / HPSA Designation
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            HRSA data not yet loaded. Run <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 3, fontSize: 11 }}>npm run data:hrsa</code> to bundle shortage area data, then rebuild.
          </div>
        </div>
        <a href="https://data.hrsa.gov/tools/shortage-area/by-address" target="_blank" rel="noopener noreferrer"
          style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: "#2d7dd2", textDecoration: "none", whiteSpace: "nowrap" }}>
          Verify at HRSA ↗
        </a>
      </div>
    );
  }

  const anyDesignation = hrsa && (hrsa.pc || hrsa.dh || hrsa.mh || hrsa.mua || hrsa.mup);

  return (
    <div style={{
      background: anyDesignation ? "rgba(13,148,136,0.03)" : "white",
      border: `1px solid ${anyDesignation ? "rgba(13,148,136,0.25)" : "#e2e8f0"}`,
      borderRadius: 10, padding: "16px 20px", marginBottom: 12, position: "relative", overflow: "hidden",
    }}>
      {anyDesignation && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#0d9488,#14b8a6)" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase" }}>
          MUA / HPSA Designation
        </div>
        {countyFips5 && (
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>
            County FIPS: <span style={{ fontFamily: "monospace" }}>{countyFips5}</span>
          </div>
        )}
      </div>

      {hrsa ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <HrsaDesignationBadge label="Primary Care HPSA"  data={hrsa.pc}  scoreLabel="HPSA score" />
            <HrsaDesignationBadge label="Dental Health HPSA" data={hrsa.dh}  scoreLabel="HPSA score" />
            <HrsaDesignationBadge label="Mental Health HPSA" data={hrsa.mh}  scoreLabel="HPSA score" />
            <HrsaDesignationBadge label="Medically Underserved Area" data={hrsa.mua} />
            {hrsa.mup && <HrsaDesignationBadge label="Medically Underserved Pop." data={hrsa.mup} />}
          </div>
          {!anyDesignation && (
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              No active HPSA or MUA/P designation found for this county.
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: "#64748b" }}>
          County FIPS not resolved — HRSA lookup unavailable for this entry.
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
        <span>
          Source: HRSA Bureau of Health Workforce
          {vintage ? ` · ${vintage}` : ""}
          {" · "}
          <em>Designations update periodically — verify current status at{" "}
            <a href="https://data.hrsa.gov/tools/shortage-area/by-address" target="_blank" rel="noopener noreferrer"
              style={{ color: "#94a3b8" }}>
              data.hrsa.gov
            </a>
          </em>
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NMTCScreener() {
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateAbbr, setStateAbbr] = useState("");
  const [zip, setZip] = useState("");
  const [manualGeoid, setManualGeoid] = useState("");
  const [showGeoidEntry, setShowGeoidEntry] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadStep, setLoadStep] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Preload static data files in background
    preloadTractData().catch(() => {});
    preloadOZData().catch(() => {});
    preloadHrsaData().catch(() => {});
  }, []);

  const analyze = async () => {
    if (!street.trim() || !city.trim() || !stateAbbr.trim()) return;
    setLoading(true); setError(null); setResults(null);

    try {
      // Step 1 — Geocode
      setLoadStep("Geocoding address via Census Bureau...");
      const geo = await geocodeAddress(street, city, stateAbbr, zip);

      // Step 2 — CDFI Fund tract lookup (ensure data is loaded)
      setLoadStep("Looking up tract in CDFI Fund eligibility data...");
      await preloadTractData();
      await preloadOZData();
      await preloadHrsaData();
      const tract = lookupTract(geo.geoid);
      if (!tract) throw new Error(`Tract GEOID ${geo.geoid} not found in CDFI Fund dataset. The bundled data file may be empty — run 'node scripts/process-cdfi-data.mjs' to populate it.`);

      // Step 3 — OZ lookup
      setLoadStep("Checking Opportunity Zone status...");
      const oz = isOpportunityZone(geo.geoid);

      // Step 4 — HUBZone
      setLoadStep("Checking HUBZone designation via SBA...");
      let hubZone = { designated: false, checked: false };
      try {
        hubZone = await checkHubZone(geo.lat, geo.lon);
      } catch {
        hubZone = { designated: false, checked: false, error: true };
      }

      // Step 5a — HRSA shortage area lookup (county-level, from bundled data)
      const countyFips5 = geo.stateCode && geo.countyCode
        ? `${geo.stateCode}${geo.countyCode}`.padStart(5, "0").slice(0, 5)
        : null;
      const hrsa = countyFips5 ? lookupHrsaByCounty(geo.stateCode, geo.countyCode) : null;

      // Step 6 — Assemble — all flags come directly from CDFI Fund data
      const povertyRate      = parseFloat(tract.poverty_rate ?? 0);
      const mfiRatio         = parseFloat(tract.mfi_ratio ?? 0);
      const unemploymentRate = parseFloat(tract.unemployment_rate ?? 0);
      const povertyEligible      = !!tract.poverty_eligible;
      const incomeEligible       = !!tract.income_eligible;
      const unemploymentEligible = !!tract.unemployment_eligible;
      const eligible             = !!tract.eligible || povertyEligible || incomeEligible || unemploymentEligible;

      // Use CDFI Fund pre-calculated distress flags when available, otherwise derive
      const severelyDistressed = !!tract.severely_distressed ||
        (povertyRate >= 30 && mfiRatio > 0 && mfiRatio <= 60);

      // Deep Distress — use CDFI Fund flag if present, else derive from rates
      const deepBasis = [];
      if (povertyRate > 40) deepBasis.push("poverty_rate_40");
      if (mfiRatio > 0 && mfiRatio <= 40) deepBasis.push("mfi_40");
      if (unemploymentRate >= 9.25) deepBasis.push("unemployment_2_5x"); // 2.5× ~3.7% national
      const deepDistress = !!tract.deep_distress || deepBasis.length > 0;

      const eligibilityBasis = povertyEligible ? "poverty_rate" : incomeEligible ? "mfi" : unemploymentEligible ? "unemployment" : null;

      const resultData = {
        matchedAddress: geo.matchedAddress,
        geoid: geo.geoid,
        tractName: tract.tract_name || `Census Tract ${geo.tractCode}, ${geo.county}, ${stateAbbr}`,
        lat: geo.lat, lon: geo.lon,
        povertyRate, mfiRatio, unemploymentRate,
        eligible, eligibilityBasis,
        povertyEligible, incomeEligible, unemploymentEligible,
        severelyDistressed, deepDistress, deepDistressBasis: deepBasis,
        highMigration: !!tract.high_migration,
        isOpportunityZone: oz,
        hubZone,
        hrsa,
        countyFips5,
        isDemo: false,
      };
      setResults(resultData);
      logSearch({
        addressInput: `${street}, ${city}, ${stateAbbr} ${zip}`.trim().replace(/,\s*$/, ""),
        matchedAddress: geo.matchedAddress,
        geoid: geo.geoid,
        eligible: resultData.eligible,
        distressTier: computeTier(resultData),
        ozStatus: oz,
        hubzoneStatus: hubZone.designated,
        geocodedBy: geo.geocodedBy,
      });
    } catch (e) {
      setError(e.message || "Unexpected error.");
    } finally {
      setLoading(false); setLoadStep("");
    }
  };

  const analyzeByGeoid = async () => {
    const geoid = manualGeoid.trim().replace(/\s/g, "").padStart(11, "0");
    if (!/^\d{11}$/.test(geoid)) { setError("GEOID must be an 11-digit census tract code (e.g. 22071007000)."); return; }
    setLoading(true); setError(null); setResults(null);
    try {
      setLoadStep("Loading CDFI Fund tract data...");
      await preloadTractData();
      await preloadOZData();
      await preloadHrsaData();
      const tract = lookupTract(geoid);
      if (!tract) throw new Error(`GEOID ${geoid} not found in CDFI Fund dataset.`);
      const povertyRate      = parseFloat(tract.poverty_rate ?? 0);
      const mfiRatio         = parseFloat(tract.mfi_ratio ?? 0);
      const unemploymentRate = parseFloat(tract.unemployment_rate ?? 0);
      const povertyEligible      = !!tract.poverty_eligible;
      const incomeEligible       = !!tract.income_eligible;
      const unemploymentEligible = !!tract.unemployment_eligible;
      const eligible = !!tract.eligible || povertyEligible || incomeEligible || unemploymentEligible;
      const severelyDistressed = !!tract.severely_distressed || (povertyRate >= 30 && mfiRatio > 0 && mfiRatio <= 60);
      const deepBasis = [];
      if (povertyRate > 40) deepBasis.push("poverty_rate_40");
      if (mfiRatio > 0 && mfiRatio <= 40) deepBasis.push("mfi_40");
      if (unemploymentRate >= 9.25) deepBasis.push("unemployment_2_5x");
      const deepDistress = !!tract.deep_distress || deepBasis.length > 0;
      const oz = isOpportunityZone(geoid);
      // Derive county FIPS from GEOID (first 5 digits = state + county)
      const countyFips5 = geoid.slice(0, 5);
      const hrsa = lookupHrsaByFips5(countyFips5);
      setResults({
        matchedAddress: `Manual GEOID entry: ${geoid}`,
        geoid,
        tractName: tract.tract_name || "",
        lat: null, lon: null,
        povertyRate, mfiRatio, unemploymentRate,
        eligible, eligibilityBasis: povertyEligible ? "poverty_rate" : incomeEligible ? "mfi" : unemploymentEligible ? "unemployment" : null,
        povertyEligible, incomeEligible, unemploymentEligible,
        severelyDistressed, deepDistress, deepDistressBasis: deepBasis,
        highMigration: !!tract.high_migration,
        isOpportunityZone: oz,
        hubZone: { designated: false, checked: false },
        hrsa,
        countyFips5,
        isManualGeoid: true,
        isDemo: false,
      });
    } catch (e) {
      setError(e.message || "Unexpected error.");
    } finally {
      setLoading(false); setLoadStep("");
    }
  };

  const fmtPct = n => (n != null && !isNaN(n)) ? `${Number(n).toFixed(1)}%` : "N/A";

  const r = results;
  const tier = r ? computeTier(r) : null;
  const tc = tier ? TIER_CONFIG[tier] : null;

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0c1f3a", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#2d7dd2,#0ea5e9)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "white" }}>N</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4a6282", textTransform: "uppercase" }}>New Markets Capital Advisors</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>NMTC Eligibility Screener</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/dashboard" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Dashboard</Link>
          <Link to="/admin" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Admin</Link>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 20px" }}>
        {/* Address form */}
        <div style={{ background: "white", borderRadius: 12, padding: "24px 28px", border: "1px solid #e2e8f0", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 16 }}>Project Address</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 80px 80px auto", gap: 10, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Street</div>
              <input
                style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 14, fontFamily: "inherit", background: "#f8fafc" }}
                value={street} onChange={e => setStreet(e.target.value)}
                onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="123 Main Street"
              />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>City</div>
              <input
                style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 14, fontFamily: "inherit", background: "#f8fafc" }}
                value={city} onChange={e => setCity(e.target.value)}
                onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="City"
              />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>State</div>
              <select
                style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 14, fontFamily: "inherit", background: "#f8fafc", cursor: "pointer" }}
                value={stateAbbr} onChange={e => setStateAbbr(e.target.value)}
              >
                <option value="">—</option>
                {US_STATES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>ZIP</div>
              <input
                style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 14, fontFamily: "inherit", background: "#f8fafc" }}
                value={zip} onChange={e => setZip(e.target.value)}
                onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="ZIP"
                maxLength={10}
              />
            </div>
            <button
              onClick={analyze}
              disabled={loading || !street || !city || !stateAbbr}
              style={{
                background: (loading || !street || !city || !stateAbbr) ? "#cbd5e1" : "linear-gradient(135deg,#1a4f7a,#2d7dd2)",
                color: "white", border: "none", borderRadius: 7, padding: "11px 20px",
                fontSize: 13, fontWeight: 700, cursor: (loading || !street || !city || !stateAbbr) ? "not-allowed" : "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {loading ? "Running..." : "Analyze →"}
            </button>
          </div>
          {loading && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 14, height: 14, border: "2px solid #2d7dd2", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              <span style={{ fontSize: 12, color: "#64748b" }}>{loadStep}</span>
            </div>
          )}

          {/* Manual GEOID entry — for CIMS-verified lookups */}
          <div style={{ marginTop: 14, borderTop: "1px solid #f1f5f9", paddingTop: 12 }}>
            <button
              onClick={() => setShowGeoidEntry(v => !v)}
              style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              {showGeoidEntry ? "▾" : "▸"} Enter Census Tract GEOID directly (from CIMS)
            </button>
            {showGeoidEntry && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>
                    11-Digit GEOID from CIMS
                  </div>
                  <input
                    style={{ width: "100%", padding: "10px 13px", border: "1.5px solid #e2e8f0", borderRadius: 7, fontSize: 14, fontFamily: "monospace", background: "#f8fafc" }}
                    value={manualGeoid}
                    onChange={e => setManualGeoid(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && analyzeByGeoid()}
                    placeholder="22071007000"
                    maxLength={11}
                  />
                </div>
                <button
                  onClick={analyzeByGeoid}
                  disabled={loading || !manualGeoid.trim()}
                  style={{
                    background: (loading || !manualGeoid.trim()) ? "#cbd5e1" : "#0f172a",
                    color: "white", border: "none", borderRadius: 7, padding: "11px 18px",
                    fontSize: 13, fontWeight: 700, cursor: (loading || !manualGeoid.trim()) ? "not-allowed" : "pointer",
                    fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  Look Up GEOID →
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", marginBottom: 16, color: "#dc2626", fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {r && (
          <div className="fade">
            {r.isManualGeoid && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 16px", marginBottom: 14, fontSize: 12, color: "#166534" }}>
                ✓ Results for manually entered GEOID <strong style={{ fontFamily: "monospace" }}>{r.geoid}</strong> — data sourced directly from CDFI Fund tract dataset. HUBZone status not checked (requires lat/lon from geocoding).
              </div>
            )}

            {/* Eligibility verdict */}
            <div style={{
              background: tc.bg, color: "white", borderRadius: 12,
              padding: "22px 26px", marginBottom: 14,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 6 }}>
                  Eligibility Determination
                </div>
                {tc.badge && (
                  <div style={{
                    display: "inline-block", marginBottom: 8,
                    background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 4, padding: "2px 10px", fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                  }}>
                    {tc.badge}
                  </div>
                )}
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {r.eligible ? "✓ " : "✗ "}{tc.label}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {r.povertyEligible && <Chip label="Poverty Rate" />}
                  {r.incomeEligible && <Chip label="MFI / Income" />}
                  {r.unemploymentEligible && <Chip label="Unemployment" />}
                  {!r.eligible && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>No standard LIC criteria met</span>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Census Tract GEOID</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", letterSpacing: 2 }}>{r.geoid}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 4, fontWeight: 500 }}>
                  Matched: {r.matchedAddress}
                </div>
              </div>
            </div>

            {/* Deep Distress banner */}
            {r.deepDistress && <DeepDistressBanner basis={r.deepDistressBasis} highMigration={r.highMigration} />}

            {/* Street name mismatch warning */}
            {!r.isManualGeoid && r.matchedAddress && (() => {
              const inputStreet = street.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
              const matched = r.matchedAddress.toLowerCase().replace(/[^a-z0-9 ]/g, "");
              // Extract first word of street number + next word as a rough check
              const inputWords = inputStreet.split(" ").filter(Boolean);
              const matchWords = matched.split(",")[0].split(" ").filter(Boolean);
              // Check if key street word from input appears in matched address
              const keyWord = inputWords.find(w => w.length > 3 && !/^\d+$/.test(w));
              const streetMatches = !keyWord || matchWords.some(w => w.includes(keyWord) || keyWord.includes(w));
              if (!streetMatches) return (
                <div style={{ background: "#fff7ed", border: "1.5px solid #fb923c", borderRadius: 8, padding: "12px 16px", marginBottom: 14, fontSize: 12, color: "#9a3412", lineHeight: 1.6 }}>
                  ⚠ <strong>Street name mismatch — verify before relying on this result.</strong> You entered <strong>"{street}"</strong> but the geocoder matched <strong>"{r.matchedAddress.split(",")[0]}"</strong>. The geocoder may have matched a nearby street with a similar name. If this is incorrect, try a different address format or use the manual GEOID entry field above.
                </div>
              );
              return null;
            })()}

            {/* CIMS warning */}
            <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 8, padding: "12px 16px", marginBottom: 14, fontSize: 12, color: "#854d0e", lineHeight: 1.6 }}>
              ⚠ <strong>Verify in CIMS v.4 before any application.</strong> CIMS is the only system CDFI Fund and IRS will guarantee eligibility for — this tool is for preliminary screening only. Discrepancies can occur for addresses near census tract boundaries, where this tool's geocoder and CIMS may assign different tracts.{" "}
              {!r.isManualGeoid && <span>If the GEOID above differs from CIMS, use the <strong>"Enter GEOID directly"</strong> field above to look up the CIMS-verified tract.</span>}
            </div>

            {/* Three LIC metric cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <MetricCard
                label="Poverty Rate"
                value={fmtPct(r.povertyRate)}
                threshold="Threshold: ≥ 20%"
                met={r.povertyEligible}
                note={r.povertyRate > 40 ? "⚡ Exceeds 40% — Deep Distress threshold" : r.povertyRate >= 30 ? "≥ 30% — Severe Distress threshold met" : undefined}
              />
              <MetricCard
                label="Median Family Income"
                value={r.mfiRatio != null ? fmtPct(r.mfiRatio) : "N/A"}
                sub="of area median income"
                threshold="Threshold: ≤ 80% of AMI"
                met={r.incomeEligible}
                note={r.mfiRatio <= 40 ? "⚡ ≤ 40% — Deep Distress threshold" : r.mfiRatio <= 60 ? "≤ 60% — Severe Distress threshold met" : undefined}
              />
              <MetricCard
                label="Unemployment Rate"
                value={fmtPct(r.unemploymentRate)}
                threshold="Threshold: ≥ 1.5× national avg"
                met={r.unemploymentEligible}
                note={r.unemploymentRate >= 9.25 ? "⚡ ≥ 2.5× national avg — Deep Distress threshold" : undefined}
              />
            </div>

            {/* Distress + OZ + HUBZone row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              {/* Severe Distress */}
              <div style={{
                background: r.severelyDistressed ? "rgba(217,119,6,0.05)" : "white",
                border: `1px solid ${r.severelyDistressed ? "rgba(217,119,6,0.35)" : "#e2e8f0"}`,
                borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
                gridColumn: r.deepDistress ? "span 1" : "span 1",
              }}>
                {r.severelyDistressed && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#d97706" }} />}
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>Severe Distress</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: r.severelyDistressed ? "#d97706" : "#94a3b8", fontFamily: "monospace", marginBottom: 6 }}>
                  {r.severelyDistressed ? "YES" : "NO"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                  {r.severelyDistressed ? "Poverty ≥ 30% AND MFI ≤ 60% of area median." : "Does not meet primary severe distress thresholds (poverty ≥ 30% + MFI ≤ 60%)."}
                </div>
              </div>

              {/* Deep Distress */}
              <div style={{
                background: r.deepDistress ? "rgba(220,38,38,0.05)" : "white",
                border: `1.5px solid ${r.deepDistress ? "rgba(220,38,38,0.4)" : "#e2e8f0"}`,
                borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
              }}>
                {r.deepDistress && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#dc2626" }} />}
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 10 }}>Deep Distress (2025)</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: r.deepDistress ? "#dc2626" : "#94a3b8", fontFamily: "monospace", marginBottom: 6 }}>
                  {r.deepDistress ? "YES" : "NO"}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
                  {r.deepDistress ? "Meets CDFI Fund 2025 Deep Distress criteria. Potential scoring advantage." : "Does not meet 2025 Deep Distress thresholds."}
                </div>
              </div>

              {/* Opportunity Zone */}
              <StatusCard
                label="Opportunity Zone"
                designated={r.isOpportunityZone}
                icon="◎"
                color="#7c3aed"
                description={r.isOpportunityZone ? "Treasury-designated OZ tract. May qualify for OZ tax incentives." : "Not a designated Opportunity Zone tract."}
                note="Source: Treasury OZ tract list"
              />

              {/* HUBZone */}
              <StatusCard
                label="HUBZone"
                designated={r.hubZone?.designated}
                icon="⬡"
                color="#0891b2"
                description={
                  r.hubZone?.error
                    ? "SBA API unavailable — verify manually at certify.sba.gov"
                    : r.hubZone?.designated
                      ? "SBA-designated HUBZone. Supplemental severe distress indicator."
                      : !r.hubZone?.checked
                        ? "Status not checked — run a real address to query SBA."
                        : "Not a designated HUBZone."
                }
                note="Source: SBA HUBZone API"
              />
            </div>

            {/* MUA / HPSA inline designation panel */}
            <HrsaPanel
              hrsa={r.hrsa}
              countyFips5={r.countyFips5}
              dataPopulated={isHrsaDataPopulated()}
              vintage={getHrsaVintage()}
            />

            {/* Dashboard link */}
            <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 20px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                View CDE QEI availability and search history in the{" "}
                <Link to="/dashboard" style={{ color: "#2d7dd2", fontWeight: 700 }}>Dashboard →</Link>
              </div>
            </div>

            {/* Methodology footnote */}
            <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.7, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              <strong style={{ color: "#64748b" }}>Methodology:</strong> Eligibility data sourced directly from the CDFI Fund tract-level dataset (2016–2020 ACS 5-Year Estimates). Poverty rate, MFI ratio, and unemployment rate are published values from the CDFI Fund — not recalculated from raw Census variables. Deep Distress criteria reflect the 2025 CDFI Fund allocation application. Opportunity Zone data from Treasury/IRS published tract list. HUBZone status from SBA API. HPSA and MUA/P designations sourced from HRSA Bureau of Health Workforce downloadable data files ({getHrsaVintage() || "run npm run data:hrsa to populate"}); designations are county-level and update periodically — current status should be confirmed at data.hrsa.gov before relying on these results for clinical or funding purposes. Geocoding accuracy is highest for standard urban addresses via the Census Bureau geocoder; rural and small-town addresses may fall back to OpenStreetMap (Nominatim) or the FCC block API and should be verified with a manual GEOID entry from CIMS. <strong>All NMTC eligibility determinations must be verified in CIMS v.4 prior to application to avoid recapture risk. NMTC Native areas, high-migration rural counties, and U.S. territories may qualify for Deep Distress under supplemental criteria — verify manually with CDFI Fund.</strong>
            </div>
          </div>
        )}

        {!r && !loading && !error && (
          <div style={{ textAlign: "center", padding: "56px 20px" }}>
            <div style={{ fontSize: 44, marginBottom: 14, opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>Enter a project address to analyze eligibility</div>
            <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
              Geocodes via Census Bureau · Looks up CDFI Fund tract data · Tests all LIC criteria · Flags Severe and Deep Distress · Checks OZ and HUBZone status
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
