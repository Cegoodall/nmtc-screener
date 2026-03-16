import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { logout } from "./lib/auth";
import { getCDEAllocations, toggleRelationship } from "./data/cdeStore";
import { getSearchHistory } from "./data/searchHistory";
import { isSupabaseConfigured } from "./lib/supabase";

const TIER_LABELS = {
  ineligible: { label: "Ineligible",           color: "#64748b", bg: "#f8fafc" },
  lic:        { label: "Eligible LIC",          color: "#16a34a", bg: "#f0fdf4" },
  severe:     { label: "Severely Distressed",   color: "#d97706", bg: "#fffbeb" },
  deep:       { label: "Deep Distress",         color: "#dc2626", bg: "#fef2f2" },
};

function TierBadge({ tier }) {
  const cfg = TIER_LABELS[tier] || TIER_LABELS.ineligible;
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}40`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
    }}>
      {cfg.label}
    </span>
  );
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function DashboardPage() {
  const [allocations, setAllocations]   = useState([]);
  const [history, setHistory]           = useState([]);
  const [loadingCDE, setLoadingCDE]     = useState(true);
  const [loadingHist, setLoadingHist]   = useState(true);
  const [activeTab, setActiveTab]       = useState("cde");

  useEffect(() => {
    getCDEAllocations().then(d => { setAllocations(d); setLoadingCDE(false); });
    getSearchHistory({ limit: 200 }).then(d => { setHistory(d); setLoadingHist(false); });
  }, []);

  const handleToggle = async (record) => {
    await toggleRelationship(record);
    const updated = await getCDEAllocations();
    setAllocations(updated);
  };

  const fmtM = n => n > 0 ? `$${Number(n).toLocaleString()}M` : "—";

  const sorted = [...allocations].sort((a, b) => {
    if (a.nmca_relationship && !b.nmca_relationship) return -1;
    if (!a.nmca_relationship && b.nmca_relationship) return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ background: "#0c1f3a", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#2d7dd2,#0ea5e9)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "white" }}>N</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4a6282", textTransform: "uppercase" }}>New Markets Capital Advisors</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>Dashboard</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Screener</Link>
          <Link to="/admin" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textDecoration: "none" }}>Admin</Link>
          <button
            onClick={() => { logout(); window.location.reload(); }}
            style={{ fontSize: 11, fontWeight: 700, color: "#64748b", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px" }}>

        {!isSupabaseConfigured() && (
          <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#854d0e" }}>
            ⚠ Supabase not configured — showing localStorage data. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file.
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "white", borderRadius: 10, padding: 4, border: "1px solid #e2e8f0", width: "fit-content" }}>
          {[["cde", `QEI Availability (${allocations.length})`], ["history", `Search History (${history.length})`]].map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "8px 18px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: "none", fontFamily: "inherit",
              background: activeTab === tab ? "#0c1f3a" : "transparent",
              color: activeTab === tab ? "white" : "#64748b",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── CDE Allocations tab ─────────────────────────────────────────── */}
        {activeTab === "cde" && (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>
                  CDE QEI Availability
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {allocations.filter(a => a.nmca_relationship).length} NMCA relationships · {allocations.length} total CDEs
                </div>
              </div>
              <Link to="/admin" style={{
                fontSize: 11, fontWeight: 700, color: "#2d7dd2",
                background: "#eff6ff", border: "1px solid #bfdbfe",
                borderRadius: 6, padding: "6px 14px", textDecoration: "none",
              }}>
                Upload New Data ↗
              </Link>
            </div>

            {loadingCDE ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Loading...</div>
            ) : sorted.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>
                No CDE data loaded. <Link to="/admin" style={{ color: "#2d7dd2", fontWeight: 700 }}>Upload a QEI file →</Link>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                    {["CDE", "Remaining Allocation", "Geography", "Focus", "NMCA Relationship"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 0", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc", background: r.nmca_relationship ? "rgba(45,125,210,0.03)" : "transparent" }}>
                      <td style={{ padding: "11px 0", fontWeight: 600, fontSize: 13, color: "#1e293b" }}>
                        {r.nmca_relationship && (
                          <span style={{ marginRight: 7, background: "#eff6ff", color: "#2d7dd2", border: "1px solid #bfdbfe", borderRadius: 4, padding: "1px 6px", fontSize: 9, fontWeight: 800 }}>NMCA</span>
                        )}
                        {r.name || r.cde}
                      </td>
                      <td style={{ padding: "11px 8px", fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>{fmtM(r.remaining_allocation)}</td>
                      <td style={{ padding: "11px 8px", fontSize: 12, color: "#64748b" }}>{r.geography || r.service_area || "—"}</td>
                      <td style={{ padding: "11px 8px", fontSize: 12, color: "#64748b" }}>{r.focus || r.project_type || "—"}</td>
                      <td style={{ padding: "11px 0" }}>
                        <button
                          onClick={() => handleToggle(r)}
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
        )}

        {/* ── Search History tab ──────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 20 }}>
              Recent Address Searches
            </div>

            {loadingHist ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Loading...</div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>
                No searches logged yet. Run an address through the screener.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #f1f5f9" }}>
                      {["Timestamp", "Address", "GEOID", "Eligible", "Distress Tier", "OZ", "HUBZone"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 8px 8px 0", fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "10px 8px 10px 0", fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtDate(row.searched_at)}</td>
                        <td style={{ padding: "10px 8px", fontSize: 12, color: "#1e293b", maxWidth: 280 }}>
                          <div style={{ fontWeight: 600 }}>{row.address_input}</div>
                          {row.matched_address && row.matched_address !== row.address_input && (
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>→ {row.matched_address}</div>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px", fontFamily: "monospace", fontSize: 12 }}>{row.geoid || "—"}</td>
                        <td style={{ padding: "10px 8px", fontSize: 12 }}>
                          <span style={{ color: row.eligible ? "#16a34a" : "#64748b", fontWeight: 700 }}>
                            {row.eligible == null ? "—" : row.eligible ? "Yes" : "No"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 8px" }}><TierBadge tier={row.distress_tier} /></td>
                        <td style={{ padding: "10px 8px", fontSize: 12 }}>
                          {row.oz_status == null ? "—" : row.oz_status ? <span style={{ color: "#7c3aed", fontWeight: 700 }}>Yes</span> : "No"}
                        </td>
                        <td style={{ padding: "10px 8px", fontSize: 12 }}>
                          {row.hubzone_status == null ? "—" : row.hubzone_status ? <span style={{ color: "#0891b2", fontWeight: 700 }}>Yes</span> : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
