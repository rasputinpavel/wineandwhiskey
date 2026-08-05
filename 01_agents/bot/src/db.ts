// One shared Supabase client for the bot. Uses the same service-role key that
// tools.ts uses for stock queries. Null when env is missing, so the PO archive
// degrades gracefully instead of crashing the bot at import.

import { createClient } from "@supabase/supabase-js";

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

if (!supabase) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — PO archive disabled.");
}

// Private Storage bucket holding the PO scans (created once in Supabase Studio).
export const PO_BUCKET = "po-scans";
