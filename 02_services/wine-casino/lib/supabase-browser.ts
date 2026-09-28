import { createClient } from '@supabase/supabase-js'

/**
 * Browser client for Realtime and the two anon-readable tables. Never sees answers.
 *
 * Deliberately in its own file, away from lib/supabase.ts. That module builds
 * the service-role clients and asserts SUPABASE_URL / SUPABASE_SERVICE_KEY at
 * import time. Those are server-only, so Next leaves them undefined in the
 * browser bundle — and because Timer and Leaderboard reach lib/realtime, every
 * guest, host and TV screen imported it and threw on load, before any
 * try/catch inside an effect could run. The admin screens survived only
 * because they happen not to use those components.
 *
 * The env vars are read as literal `process.env.NEXT_PUBLIC_*` expressions on
 * purpose: Next inlines them at build time by matching the source text, so a
 * dynamic `process.env[name]` lookup silently yields undefined in the browser.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `wine-casino: ${name} is not set. NEXT_PUBLIC_* values are baked into the browser ` +
      `bundle when the image is built, so set it on the Railway service and rebuild.`,
    )
  }
  return value
}

export function browserClient() {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    { db: { schema: 'casino' } },
  )
}
