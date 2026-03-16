/**
 * Search history logger — writes to Supabase search_history table.
 * Silently no-ops if Supabase is not configured.
 */

import { supabase } from "../lib/supabase";

export async function logSearch({ addressInput, matchedAddress, geoid, eligible, distressTier, ozStatus, hubzoneStatus, geocodedBy }) {
  if (!supabase) return;
  try {
    await supabase.from("search_history").insert({
      address_input:   addressInput,
      matched_address: matchedAddress,
      geoid,
      eligible,
      distress_tier:   distressTier,
      oz_status:       ozStatus,
      hubzone_status:  hubzoneStatus,
      geocoded_by:     geocodedBy ?? null,
    });
  } catch {
    // Non-blocking — never surface logging errors to the user
  }
}

export async function getSearchHistory({ limit = 100 } = {}) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("search_history")
    .select("*")
    .order("searched_at", { ascending: false })
    .limit(limit);
  return data || [];
}
