import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "../config.js";

function make(schema?: string): SupabaseClient<any, any, any> | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    ...(schema ? { db: { schema } } : {}),
  });
}

/** public schema — supplier price lists (wine_items). */
export const catalogDb = make();

/** inventory schema — Loyverse on-hand (v_sku_breakdown). */
export const inventoryDb = make("inventory");
