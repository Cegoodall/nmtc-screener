import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Returns null if env vars not configured — app degrades gracefully
export const supabase = (url && key) ? createClient(url, key) : null;

export function isSupabaseConfigured() {
  return supabase !== null;
}
