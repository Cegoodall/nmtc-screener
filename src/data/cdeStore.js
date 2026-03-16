/**
 * CDE QEI Availability — Supabase-backed store.
 * Falls back to localStorage if Supabase is not configured.
 *
 * Tables: cde_allocations, cde_flags
 * - cde_flags persists nmca_relationship across monthly uploads.
 */

import { supabase } from "../lib/supabase";

const LS_KEY  = "nmtc_cde_data";
const REL_KEY = "nmtc_cde_relationships";

// ─── Normalize key for cde_flags ─────────────────────────────────────────────

function nameKey(record) {
  return (record.name || record.cde || "").toLowerCase().trim();
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getCDEAllocations() {
  if (supabase) {
    const [{ data: rows }, { data: flags }] = await Promise.all([
      supabase.from("cde_allocations").select("*").order("nmca_relationship", { ascending: false }).order("name"),
      supabase.from("cde_flags").select("cde_name_key, nmca_relationship"),
    ]);
    const flagMap = Object.fromEntries((flags || []).map(f => [f.cde_name_key, f.nmca_relationship]));
    return (rows || []).map(r => ({
      ...r,
      nmca_relationship: flagMap[nameKey(r)] ?? r.nmca_relationship ?? false,
    }));
  }
  // Fallback: localStorage
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw);
    const rels = getLocalRelationships();
    return records.map(r => ({ ...r, nmca_relationship: rels[nameKey(r)] ?? r.nmca_relationship ?? false }));
  } catch { return []; }
}

// ─── Write — called from admin upload ────────────────────────────────────────

export async function setCDEAllocations(records, dataMonth = "") {
  if (supabase) {
    // Fetch current flags before overwrite
    const { data: flags } = await supabase.from("cde_flags").select("cde_name_key, nmca_relationship");
    const flagMap = Object.fromEntries((flags || []).map(f => [f.cde_name_key, f.nmca_relationship]));

    // Delete previous month's data
    await supabase.from("cde_allocations").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert new records with preserved relationship flags
    const rows = records.map(r => ({
      name: r.name || r.cde || "",
      remaining_allocation: r.remaining_allocation || null,
      geography: r.geography || r.service_area || "",
      focus: r.focus || r.project_type || "",
      nmca_relationship: flagMap[nameKey(r)] ?? r.nmca_relationship ?? false,
      data_month: dataMonth,
    }));

    await supabase.from("cde_allocations").insert(rows);
    return;
  }
  // Fallback: localStorage
  const rels = getLocalRelationships();
  const cleaned = records.map(r => ({
    ...r,
    nmca_relationship: rels[nameKey(r)] ?? r.nmca_relationship ?? false,
  }));
  localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
}

// ─── Toggle nmca_relationship ─────────────────────────────────────────────────

export async function toggleRelationship(record) {
  const key = nameKey(record);
  const current = record.nmca_relationship;
  const next = !current;

  if (supabase) {
    await supabase.from("cde_flags").upsert(
      { cde_name_key: key, nmca_relationship: next, updated_at: new Date().toISOString() },
      { onConflict: "cde_name_key" }
    );
    // Also update in cde_allocations for immediate consistency
    await supabase.from("cde_allocations")
      .update({ nmca_relationship: next })
      .eq("name", record.name || record.cde || "");
    return;
  }
  // Fallback: localStorage
  const rels = getLocalRelationships();
  rels[key] = next;
  localStorage.setItem(REL_KEY, JSON.stringify(rels));
}

function getLocalRelationships() {
  try { return JSON.parse(localStorage.getItem(REL_KEY) || "{}"); } catch { return {}; }
}
