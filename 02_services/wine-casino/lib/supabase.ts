import { createClient } from '@supabase/supabase-js'

// Same Supabase project as mission-control and kiosk. The `casino` schema must
// be listed under Settings -> API -> Exposed schemas or every call 404s.

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_KEY!

/** Server-side only. Bypasses RLS — this is the client that sees the answers. */
export const sbCasino = createClient(url, serviceKey, { db: { schema: 'casino' } })

/** inventory.v_sku_breakdown, for the admin's wine search. Read-only. */
export const sbInventory = createClient(url, serviceKey, { db: { schema: 'inventory' } })

/** Browser client for Realtime + the two anon-readable tables. Never sees answers. */
export function browserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'casino' } },
  )
}
