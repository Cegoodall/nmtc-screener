import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { getCDEAllocations, setCDEAllocations, toggleRelationship } from "./data/cdeStore";
import { logout } from "./lib/auth";

// ─── PDF parsing ──────────────────────────────────────────────────────────────

async function parsePDF(file) {
  // Dynamically import pdfjs to keep bundle manageable
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return extractCDERecordsFromText(fullText);
}

/**
 * Extract CDE records from the CDFI Fund QEI availability PDF.
 * The PDF has a consistent table structure: CDE name, allocation amount, geography, focus.
 * We parse line by line looking for dollar amounts as row anchors.
 */
function extractCDERecordsFromText(text) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const records = [];

  // Pattern: lines containing $ amounts indicate allocation rows
  // Typical format: "CDE Name  $XX,XXX,XXX  Geography  Focus Area"
  const amountPattern = /\$[\d,]+(?:\.\d+)?(?:\s*[Mm]illion|\s*[Mm])?/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const amountMatch = line.match(amountPattern);

    if (amountMatch) {
      // Try to extract name from this line or previous line
      const name = extractCDEName(lines, i);
      const amount = parseAmount(amountMatch[0]);
      const geography = lines[i + 1]?.trim() || "";
      const focus = lines[i + 2]?.trim() || "";

      if (name && amount > 0) {
        records.push({
          name,
          remaining_allocation: amount,
          geography,
          focus,
          nmca_relationship: false,
        });
      }
    }
    i++;
  }

  // Fallback: if no structured records found, try splitting on large text blocks
  if (records.length === 0) {
    return extractCDERecordsFallback(text);
  }

  return records;
}

function extractCDEName(lines, amountLineIndex) {
  // Name is usually on the same line before the amount, or the previous line
  const line = lines[amountLineIndex];
  const beforeAmount = line.replace(/\$[\d,]+(?:\.\d+)?(?:\s*[Mm]illion|\s*[Mm])?.*/, "").trim();
  if (beforeAmount.length > 3) return beforeAmount;
  if (amountLineIndex > 0) return lines[amountLineIndex - 1].trim();
  return null;
}

function parseAmount(str) {
  const clean = str.replace(/[$,\s]/g, "").toLowerCase();
  const num = parseFloat(clean.replace(/million|m/, ""));
  if (isNaN(num)) return 0;
  // If it doesn't contain "million" or "m" and is a large number already
  if (num > 1000) return Math.round(num / 1_000_000);
  return num;
}

function extractCDERecordsFallback(text) {
  // Very basic fallback: look for patterns like "Name LLC $XX million"
  const records = [];
  const regex = /([A-Z][A-Za-z\s,&.]+(?:LLC|Inc|Corp|Fund|Company|CDE|Community|Capital|Finance|Development)[A-Za-z\s,&.]*)\s+\$?([\d,.]+)\s*(?:million|M)?/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    records.push({
      name: match[1].trim(),
      remaining_allocation: parseFloat(match[2].replace(/,/g, "")),
      geography: "",
      focus: "",
      nmca_relationship: false,
    });
  }
  return records;
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "binary" });
        const sheetName = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

        // Normalize column names
        const records = rows.map(row => {
          const keys = Object.keys(row);
          const findCol = (...candidates) => {
            for (const c of candidates) {
              const k = keys.find(k => k.toLowerCase().includes(c.toLowerCase()));
              if (k) return row[k];
            }
            return "";
          };

          return {
            name: findCol("cde", "name", "organization"),
            remaining_allocation: parseFloat(String(findCol("remaining", "allocation", "amount", "qei")).replace(/[$,M]/gi, "")) || 0,
            geography: findCol("geography", "service area", "region", "location"),
            focus: findCol("focus", "project type", "sector", "priority"),
            nmca_relationship: false,
          };
        }).filter(r => r.name);

        resolve(records);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ─── Admin UI ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [preview, setPreview] = useState(null); // parsed records before confirmation
  const [savedRecords, setSavedRecords] = useState([]);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef();

  useEffect(() => {
    getCDEAllocations().then(setSavedRecords);
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setParsing(true); setParseError(null); setPreview(null); setSaved(false);

    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let records;

      if (ext === "pdf") {
        records = await parsePDF(file);
      } else if (["xlsx", "xls", "xlsb"].includes(ext)) {
        records = await parseExcel(file);
      } else {
        throw new Error(`Unsupported file type: .${ext}. Upload a PDF or Excel file.`);
      }

      if (!records.length) throw new Error("No CDE records could be extracted from this file. Check the file format.");
      setPreview(records);
    } catch (e) {
      setParseError(e.message || "Parse failed.");
    } finally {
      setParsing(false);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const confirmUpload = async () => {
    await setCDEAllocations(preview);
    const updated = await getCDEAllocations();
    setSavedRecords(updated);
    setPreview(null); setSaved(true);
  };

  const handleToggleRelationship = async (record) => {
    await toggleRelationship(record);
    const updated = await getCDEAllocations();
    setSavedRecords(updated);
  };

  const fmtM = n => n > 0 ? `$${Number(n).toLocaleString()}M` : "—";

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0c1f3a", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#2d7dd2,#0ea5e9)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "white" }}>N</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4a6282", textTransform: "uppercase" }}>New Markets Capital Advisors</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>Admin — CDE Data Manager</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Screener</Link>
          <Link to="/dashboard" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Dashboard</Link>
          <button
            onClick={() => { logout(); window.location.reload(); }}
            style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px" }}>

        {/* Upload zone */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>Upload QEI Availability Data</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
            Upload the monthly CDFI Fund QEI availability release. Accepts PDF or Excel (XLS/XLSX). Parsed CDE records are shown for review before going live.
          </div>

          <div
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "#2d7dd2" : "#cbd5e1"}`,
              borderRadius: 10, padding: "36px 24px", textAlign: "center", cursor: "pointer",
              background: dragging ? "rgba(45,125,210,0.04)" : "#f8fafc",
              transition: "all 0.15s",
            }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.xls,.xlsx,.xlsb" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
              {parsing ? "Parsing file..." : "Drop PDF or Excel file here"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {parsing ? "Extracting CDE records..." : "or click to browse — accepts .pdf, .xls, .xlsx"}
            </div>
            {parsing && (
              <div style={{ marginTop: 12, display: "inline-block", width: 20, height: 20, border: "2px solid #2d7dd2", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
            )}
          </div>

          {parseError && (
            <div style={{ marginTop: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", color: "#dc2626", fontSize: 13 }}>
              ⚠ {parseError}
            </div>
          )}
        </div>

        {/* Preview panel */}
        {preview && (
          <div style={{ background: "white", border: "1.5px solid #2d7dd2", borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#2d7dd2", textTransform: "uppercase", marginBottom: 4 }}>
                  Preview — {preview.length} records parsed
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Review before saving. Existing NMCA relationship flags are preserved.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPreview(null)}
                  style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", color: "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Discard
                </button>
                <button onClick={confirmUpload}
                  style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "linear-gradient(135deg,#1a4f7a,#2d7dd2)", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Confirm & Save →
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 380, overflowY: "auto", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
                  <tr>
                    {["CDE Name", "Allocation", "Geography", "Focus"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 ? "#fafafa" : "white" }}>
                      <td style={{ padding: "9px 12px", fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{r.name}</td>
                      <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 13 }}>{fmtM(r.remaining_allocation)}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b" }}>{r.geography || "—"}</td>
                      <td style={{ padding: "9px 12px", fontSize: 12, color: "#64748b" }}>{r.focus || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {saved && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 16px", marginBottom: 20, color: "#166534", fontSize: 13, fontWeight: 600 }}>
            ✓ Data saved — {savedRecords.length} CDEs now live in the screener.
          </div>
        )}

        {/* Current CDE data with relationship toggles */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 16 }}>
            Current CDE Data — {savedRecords.length} records
          </div>
          {savedRecords.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>
              No data loaded yet. Upload a QEI availability file above.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                  {["CDE", "Allocation", "Geography", "Focus", "NMCA Relationship"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {savedRecords.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f8fafc", background: r.nmca_relationship ? "rgba(45,125,210,0.03)" : "transparent" }}>
                    <td style={{ padding: "11px 0", fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{r.name || r.cde}</td>
                    <td style={{ padding: "11px 8px", fontFamily: "monospace", fontSize: 13 }}>{fmtM(r.remaining_allocation)}</td>
                    <td style={{ padding: "11px 8px", fontSize: 12, color: "#64748b" }}>{r.geography || r.service_area || "—"}</td>
                    <td style={{ padding: "11px 8px", fontSize: 12, color: "#64748b" }}>{r.focus || r.project_type || "—"}</td>
                    <td style={{ padding: "11px 0" }}>
                      <button
                        onClick={() => handleToggleRelationship(r)}
                        style={{
                          padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          border: r.nmca_relationship ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                          background: r.nmca_relationship ? "#eff6ff" : "white",
                          color: r.nmca_relationship ? "#2d7dd2" : "#94a3b8",
                        }}
                      >
                        {r.nmca_relationship ? "★ NMCA" : "☆ Set NMCA"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
