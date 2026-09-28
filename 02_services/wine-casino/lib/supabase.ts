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

// The browser client lives in lib/supabase-browser.ts: importing this module
// from client code crashes it, because the asserts above are server-only.
