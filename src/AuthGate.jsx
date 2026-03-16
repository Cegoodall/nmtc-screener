import { useState } from "react";
import { Link } from "react-router-dom";
import { isAuthenticated, login } from "./lib/auth";

export default function AuthGate({ children }) {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  if (authed) return children;

  const attempt = () => {
    if (login(password)) {
      setAuthed(true);
    } else {
      setError(true);
      setPassword("");
    }
  };

  return (
    <div style={{ fontFamily: "system-ui,-apple-system,sans-serif", background: "#f1f5f9", minHeight: "100vh" }}>
      <div style={{ background: "#0c1f3a", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#2d7dd2,#0ea5e9)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "white" }}>N</div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#4a6282", textTransform: "uppercase" }}>New Markets Capital Advisors</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "white" }}>NMTC Eligibility Screener</div>
        </div>
      </div>

      <div style={{ maxWidth: 400, margin: "80px auto", padding: "0 20px" }}>
        <div style={{ background: "white", borderRadius: 12, padding: "32px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#94a3b8", textTransform: "uppercase", marginBottom: 8 }}>Restricted Area</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 24 }}>Enter Password</div>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false); }}
            onKeyDown={e => e.key === "Enter" && attempt()}
            placeholder="Password"
            style={{
              width: "100%", padding: "10px 13px", border: `1.5px solid ${error ? "#fca5a5" : "#e2e8f0"}`,
              borderRadius: 7, fontSize: 14, fontFamily: "inherit", background: error ? "#fef2f2" : "#f8fafc",
              marginBottom: 12, boxSizing: "border-box",
            }}
          />
          {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 12 }}>Incorrect password.</div>}
          <button
            onClick={attempt}
            style={{
              width: "100%", padding: "11px", background: "linear-gradient(135deg,#1a4f7a,#2d7dd2)",
              color: "white", border: "none", borderRadius: 7, fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Sign In →
          </button>
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <Link to="/" style={{ fontSize: 12, color: "#94a3b8", textDecoration: "none" }}>← Back to Screener</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
