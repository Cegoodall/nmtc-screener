import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import NMTCScreener from "./NMTCScreener.jsx";
import AdminPage from "./AdminPage.jsx";
import DashboardPage from "./DashboardPage.jsx";
import BatchPage from "./BatchPage.jsx";
import AuthGate from "./AuthGate.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<NMTCScreener />} />
        <Route path="/batch" element={<BatchPage />} />
        <Route path="/admin" element={<AuthGate><AdminPage /></AuthGate>} />
        <Route path="/dashboard" element={<AuthGate><DashboardPage /></AuthGate>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
