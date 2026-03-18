import { useState, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { geocodeAddress } from "./api/geocoder.js";
import { checkHubZone } from "./api/hubzone.js";
import { preloadTractData, lookupTract } from "./data/tractLookup.js";
import { preloadOZData, isOpportunityZone } from "./data/ozLookup.js";
import { preloadHrsaData, lookupHrsaByCounty } from "./data/hrsaLookup.js";

// ─── Tier helpers (mirrors NMTCScreener.jsx) ──────────────────────────────────

function computeTier(r) {
  if (!r || !r.eligible) return "ineligible";
  if (r.deepDistress) return "deep";
  if (r.severelyDistressed || r.hubZone?.designated) return "severe";
  return "lic";
}

const TIER_LABELS = {
  ineligible: "Does Not Meet LIC Criteria",
  lic: "TIER 1 — LIC",
  severe: "TIER 2 — SEVERELY DISTRESSED",
  deep: "TIER 3 — DEEP DISTRESS",
};

// ─── Column headers for output file ───────────────────────────────────────────

const OUTPUT_COLUMNS = [
  "Address Input",
  "Matched Address",
  "GEOID",
  "NMTC Eligible",
  "Distress Tier",
  "Poverty Rate",
  "Poverty Eligible",
  "MFI %",
  "MFI Eligible",
  "Unemployment Rate",
  "Unemployment Eligible",
  "Severely Distressed",
  "Deep Distress",
  "Opportunity Zone",
  "HUBZone",
  "Primary Care HPSA",
  "Dental HPSA",
  "Mental Health HPSA",
  "MUA Designated",
  "Notes",
];

// ─── Address analysis (extracted from analyze() in NMTCScreener.jsx) ──────────

async function analyzeAddress(street, city, state) {
  const notes = [];

  // Geocode
  const geo = await geocodeAddress(street.trim(), city.trim(), state.trim(), "");
  if (geo.geocodedBy && geo.geocodedBy !== "Census") {
    notes.push(`Geocoder fallback used (${geo.geocodedBy})`);
  }

  // Street name mismatch check
  if (geo.matchedAddress) {
    const inputStreet = street.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
    const matched = geo.matchedAddress.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    const inputWords = inputStreet.split(" ").filter(Boolean);
    const matchWords = matched.split(",")[0].split(" ").filter(Boolean);
    const keyWord = inputWords.find(w => w.length > 3 && !/^\d+$/.test(w));
    const streetMatches = !keyWord || matchWords.some(w => w.includes(keyWord) || keyWord.includes(w));
    if (!streetMatches) {
      notes.push(`Street name mismatch: input "${street.trim()}" matched "${geo.matchedAddress.split(",")[0]}"`);
    }
  }

  // Tract lookup
  const tract = lookupTract(geo.geoid);
  if (!tract) throw new Error(`Tract GEOID ${geo.geoid} not found in CDFI Fund dataset`);

  // OZ
  const oz = isOpportunityZone(geo.geoid);

  // HUBZone
  const hubZone = await checkHubZone(geo.lat, geo.lon);
  if (hubZone.unavailable) notes.push("HUBZone status unavailable");

  // HRSA
  const hrsa = (geo.stateCode && geo.countyCode)
    ? lookupHrsaByCounty(geo.stateCode, geo.countyCode)
    : null;

  // Distress flags (mirrors NMTCScreener.jsx logic exactly)
  const povertyRate      = parseFloat(tract.poverty_rate      ?? 0);
  const mfiRatio         = parseFloat(tract.mfi_ratio         ?? 0);
  const unemploymentRate = parseFloat(tract.unemployment_rate ?? 0);
  const povertyEligible      = !!tract.poverty_eligible;
  const incomeEligible       = !!tract.income_eligible;
  const unemploymentEligible = !!tract.unemployment_eligible;
  const eligible = !!tract.eligible || povertyEligible || incomeEligible || unemploymentEligible;

  const severelyDistressed = !!tract.severely_distressed ||
    (povertyRate >= 30 && mfiRatio > 0 && mfiRatio <= 60);

  const deepBasis = [];
  if (povertyRate > 40)            deepBasis.push("poverty >40%");
  if (mfiRatio > 0 && mfiRatio <= 40) deepBasis.push("MFI ≤40%");
  if (unemploymentRate >= 9.25)    deepBasis.push("unemployment ≥9.25%");
  const deepDistress = !!tract.deep_distress || deepBasis.length > 0;

  return {
    geo, tract,
    povertyRate, mfiRatio, unemploymentRate,
    povertyEligible, incomeEligible, unemploymentEligible,
    eligible, severelyDistressed, deepDistress,
    oz, hubZone, hrsa, notes,
  };
}

// ─── Build a single output row ─────────────────────────────────────────────────

function buildRow(addressInput, result, error) {
  if (error) {
    return {
      "Address Input": addressInput,
      "Matched Address": "Not found",
      "GEOID": "",
      "NMTC Eligible": "",
      "Distress Tier": "",
      "Poverty Rate": "",
      "Poverty Eligible": "",
      "MFI %": "",
      "MFI Eligible": "",
      "Unemployment Rate": "",
      "Unemployment Eligible": "",
      "Severely Distressed": "",
      "Deep Distress": "",
      "Opportunity Zone": "",
      "HUBZone": "",
      "Primary Care HPSA": "",
      "Dental HPSA": "",
      "Mental Health HPSA": "",
      "MUA Designated": "",
      "Notes": error,
    };
  }

  const {
    geo, povertyRate, mfiRatio, unemploymentRate,
    povertyEligible, incomeEligible, unemploymentEligible,
    eligible, severelyDistressed, deepDistress,
    oz, hubZone, hrsa, notes,
  } = result;

  const tier = computeTier(result);
  const fmt1 = n => (n != null && !isNaN(n)) ? `${Number(n).toFixed(1)}%` : "";
  const yesNo = v => (v ? "Yes" : "No");

  return {
    "Address Input":       addressInput,
    "Matched Address":     geo.matchedAddress || "",
    "GEOID":               geo.geoid || "",
    "NMTC Eligible":       yesNo(eligible),
    "Distress Tier":       TIER_LABELS[tier] ?? tier,
    "Poverty Rate":        fmt1(povertyRate),
    "Poverty Eligible":    yesNo(povertyEligible),
    "MFI %":               fmt1(mfiRatio),
    "MFI Eligible":        yesNo(incomeEligible),
    "Unemployment Rate":   fmt1(unemploymentRate),
    "Unemployment Eligible": yesNo(unemploymentEligible),
    "Severely Distressed": yesNo(severelyDistressed),
    "Deep Distress":       yesNo(deepDistress),
    "Opportunity Zone":    yesNo(oz),
    "HUBZone":             hubZone.unavailable ? "Unavailable" : yesNo(hubZone.designated),
    "Primary Care HPSA":   hrsa?.pc    ? `Score ${hrsa.pc.score}`  : "No",
    "Dental HPSA":         hrsa?.dh    ? `Score ${hrsa.dh.score}`  : "No",
    "Mental Health HPSA":  hrsa?.mh    ? `Score ${hrsa.mh.score}`  : "No",
    "MUA Designated":      (hrsa?.mua || hrsa?.mup) ? "Yes" : "No",
    "Notes":               notes.join("; "),
  };
}

// ─── Parse uploaded file ───────────────────────────────────────────────────────

function parseInputFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        if (rows.length === 0) { reject(new Error("File is empty.")); return; }

        // Find Street / City / State columns (case-insensitive)
        const sample = rows[0];
        const keys = Object.keys(sample);
        const find = name => keys.find(k => k.trim().toLowerCase() === name.toLowerCase()) ?? null;

        const streetCol = find("Street") ?? find("street_address") ?? find("address");
        const cityCol   = find("City")   ?? find("city_name");
        const stateCol  = find("State")  ?? find("state_abbr") ?? find("st");

        if (!streetCol || !cityCol || !stateCol) {
          reject(new Error(
            `Could not find required columns. Expected "Street", "City", "State". ` +
            `Found: ${keys.join(", ")}`
          ));
          return;
        }

        const addresses = rows
          .map(row => ({
            street: String(row[streetCol] ?? "").trim(),
            city:   String(row[cityCol]   ?? "").trim(),
            state:  String(row[stateCol]  ?? "").trim(),
          }))
          .filter(a => a.street || a.city);

        if (addresses.length === 0) { reject(new Error("No address rows found.")); return; }

        resolve(addresses);
      } catch (err) {
        reject(new Error(`Failed to parse file: ${err.message}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Export output Excel ───────────────────────────────────────────────────────

function downloadResults(rows, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: OUTPUT_COLUMNS });

  // Column widths
  ws["!cols"] = [
    { wch: 40 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 30 },
    { wch: 13 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 18 },
    { wch: 22 }, { wch: 20 }, { wch: 13 }, { wch: 16 }, { wch: 9 },
    { wch: 17 }, { wch: 13 }, { wch: 20 }, { wch: 15 }, { wch: 60 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "NMTC Results");
  XLSX.writeFile(wb, filename);
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function BatchPage() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [addresses, setAddresses] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | preloading | processing | done | aborted
  const [progress, setProgress] = useState({ current: 0, total: 0, address: "" });
  const [outputRows, setOutputRows] = useState([]);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(async f => {
    setFile(f);
    setParseError(null);
    setAddresses(null);
    setStatus("idle");
    setOutputRows([]);
    try {
      const parsed = await parseInputFile(f);
      setAddresses(parsed);
    } catch (err) {
      setParseError(err.message);
    }
  }, []);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onDragOver = e => { e.preventDefault(); setDragActive(true); };
  const onDragLeave = () => setDragActive(false);
  const onInputChange = e => { if (e.target.files[0]) handleFile(e.target.files[0]); };

  const runBatch = async () => {
    if (!addresses || addresses.length === 0) return;
    abortRef.current = false;
    setStatus("preloading");
    setOutputRows([]);

    // Preload static data files
    await Promise.all([preloadTractData(), preloadOZData(), preloadHrsaData()]);

    setStatus("processing");
    const rows = [];

    for (let i = 0; i < addresses.length; i++) {
      if (abortRef.current) { setStatus("aborted"); break; }

      const { street, city, state } = addresses[i];
      const addressInput = [street, city, state].filter(Boolean).join(", ");
      setProgress({ current: i + 1, total: addresses.length, address: addressInput });

      try {
        const result = await analyzeAddress(street, city, state);
        rows.push(buildRow(addressInput, result, null));
      } catch (err) {
        rows.push(buildRow(addressInput, null, err.message));
      }

      setOutputRows([...rows]);
    }

    if (!abortRef.current) {
      setStatus("done");
      const ts = new Date().toISOString().slice(0, 10);
      downloadResults(rows, `nmtc-batch-${ts}.xlsx`);
    }
  };

  const abort = () => { abortRef.current = true; };

  const reset = () => {
    setFile(null);
    setAddresses(null);
    setParseError(null);
    setStatus("idle");
    setProgress({ current: 0, total: 0, address: "" });
    setOutputRows([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const isRunning = status === "processing" || status === "preloading";

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0c1f3a", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#2d7dd2,#0ea5e9)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "white" }}>N</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4a6282", textTransform: "uppercase" }}>New Markets Capital Advisors</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>NMTC Batch Screener</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/"          style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Screener</Link>
          <Link to="/dashboard" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Dashboard</Link>
          <Link to="/admin"     style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Admin</Link>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px" }}>

        {/* Upload card */}
        <div style={{ background: "white", borderRadius: 12, padding: "28px", border: "1px solid #e2e8f0", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 16 }}>Upload Address List</div>

          {/* Drag-and-drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => !isRunning && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? "#2d7dd2" : "#cbd5e1"}`,
              borderRadius: 10,
              padding: "36px 24px",
              textAlign: "center",
              cursor: isRunning ? "default" : "pointer",
              background: dragActive ? "#eff6ff" : "#f8fafc",
              transition: "border-color 0.15s, background 0.15s",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>⬆</div>
            {file ? (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>{file.name}</div>
                {addresses && (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    {addresses.length} address{addresses.length !== 1 ? "es" : ""} found
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 4 }}>
                  Drag and drop an Excel or CSV file here
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  or click to browse — requires columns: Street, City, State
                </div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onInputChange}
              style={{ display: "none" }}
            />
          </div>

          {/* Format note */}
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
            First row must be a header row with columns named <strong>Street</strong>, <strong>City</strong>, and <strong>State</strong> (two-letter abbreviation). Zip code is not required.
          </div>

          {/* Parse error */}
          {parseError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991b1b", marginBottom: 16 }}>
              {parseError}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={runBatch}
              disabled={!addresses || isRunning}
              style={{
                padding: "10px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: (!addresses || isRunning) ? "#e2e8f0" : "#2d7dd2",
                color: (!addresses || isRunning) ? "#94a3b8" : "white",
                border: "none", cursor: (!addresses || isRunning) ? "default" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {status === "preloading" ? "Loading data..." : "Run Batch"}
            </button>

            {isRunning && (
              <button
                onClick={abort}
                style={{ padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", cursor: "pointer" }}
              >
                Stop
              </button>
            )}

            {(file || status !== "idle") && !isRunning && (
              <button
                onClick={reset}
                style={{ padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", cursor: "pointer" }}
              >
                Reset
              </button>
            )}

            {status === "done" && outputRows.length > 0 && (
              <button
                onClick={() => {
                  const ts = new Date().toISOString().slice(0, 10);
                  downloadResults(outputRows, `nmtc-batch-${ts}.xlsx`);
                }}
                style={{ padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", cursor: "pointer" }}
              >
                Download Again
              </button>
            )}
          </div>
        </div>

        {/* Progress card */}
        {(isRunning || status === "done" || status === "aborted") && (
          <div style={{ background: "white", borderRadius: 12, padding: "24px 28px", border: "1px solid #e2e8f0", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
                {status === "done"    && `Complete — ${outputRows.length} addresses processed`}
                {status === "aborted" && `Stopped — ${outputRows.length} of ${progress.total} addresses processed`}
                {isRunning            && `Processing ${progress.current} of ${progress.total}...`}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{pct}%</div>
            </div>

            {/* Progress bar */}
            <div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
              <div style={{
                height: "100%",
                width: `${pct}%`,
                background: status === "done" ? "#16a34a" : status === "aborted" ? "#d97706" : "#2d7dd2",
                borderRadius: 3,
                transition: "width 0.2s",
              }} />
            </div>

            {isRunning && progress.address && (
              <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                {progress.address}
              </div>
            )}

            {status === "done" && (
              <div style={{ fontSize: 12, color: "#16a34a", marginTop: 4 }}>
                Excel file downloaded automatically.
              </div>
            )}
          </div>
        )}

        {/* Live results preview table */}
        {outputRows.length > 0 && (
          <div style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase" }}>
              Results Preview
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["#", "Address Input", "GEOID", "Eligible", "Tier", "Notes"].map(h => (
                      <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap", borderBottom: "1px solid #e2e8f0" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outputRows.map((row, i) => {
                    const eligible = row["NMTC Eligible"];
                    const notFound = row["Matched Address"] === "Not found";
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "8px 14px", color: "#94a3b8", fontFamily: "monospace" }}>{i + 1}</td>
                        <td style={{ padding: "8px 14px", color: "#1e293b", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row["Address Input"]}>
                          {row["Address Input"]}
                        </td>
                        <td style={{ padding: "8px 14px", fontFamily: "monospace", color: "#64748b" }}>{row["GEOID"]}</td>
                        <td style={{ padding: "8px 14px" }}>
                          {notFound ? (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          ) : (
                            <span style={{
                              fontWeight: 700, fontSize: 11,
                              color: eligible === "Yes" ? "#16a34a" : "#64748b",
                            }}>
                              {eligible}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "8px 14px", color: "#64748b", fontSize: 11, whiteSpace: "nowrap" }}>
                          {notFound ? <span style={{ color: "#ef4444" }}>Not found</span> : row["Distress Tier"]}
                        </td>
                        <td style={{ padding: "8px 14px", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row["Notes"]}>
                          {row["Notes"] || ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
