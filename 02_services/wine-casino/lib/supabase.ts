import { createClient } from '@supabase/supabase-js'

// Same Supabase project as mission-control and kiosk. The `casino` schema must
// be listed under Settings -> API -> Exposed schemas or every call 404s.

/**
 * Clients are built at module load, like the sibling kiosk service, so a missing
 * variable stops `next build` rather than surfacing mid-game. Supabase's own
 * error for this is "supabaseUrl is required", which tells you nothing about
 * which service or which variable, so we say it ourselves.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `wine-casino: ${name} is not set. Copy .env.example to .env.local for local work, ` +
      `or set it on the Railway service before deploying — the build reads it, not just the running app.`,
    )
  }
  return value
}

const url = required('SUPABASE_URL')
const serviceKey = required('SUPABASE_SERVICE_KEY')

/** Server-side only. Bypasses RLS — this is the client that sees the answers. */
export const sbCasino = createClient(url, serviceKey, { db: { schema: 'casino' } })

/** inventory.v_sku_breakdown, for the admin's wine search. Read-only. */
export const sbInventory = createClient(url, serviceKey, { db: { schema: 'inventory' } })

/**
 * Browser client for Realtime + the two anon-readable tables. Never sees answers.
 *
 * NEXT_PUBLIC_* values are inlined at build time: if they are missing when the
 * image is built, the phones get `undefined` and Realtime fails silently, with
 * the polling fallback quietly carrying the whole game. Fail loudly instead.
 */
export function browserClient() {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { db: { schema: 'casino' } },
  )
}
