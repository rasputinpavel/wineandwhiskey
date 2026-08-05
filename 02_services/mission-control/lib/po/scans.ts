import { sbPublic } from '@/lib/supabase'

// Scans live in a private bucket, so the portal serves them via short-lived
// signed URLs (mirrors lib/promo/storage.ts).
const BUCKET = 'po-scans'
const SIGNED_TTL_SECONDS = 60 * 60 // 1h — long enough to open a scan

// Resolve signed URLs for a batch of object paths. Returns a Map keyed by the
// same path string. On error, returns whatever succeeded (never throws) so the
// page still renders the rows, just without live scan links.
export async function signScanUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const clean = Array.from(new Set(paths.filter(Boolean)))
  if (clean.length === 0) return out
  const { data, error } = await sbPublic.storage
    .from(BUCKET)
    .createSignedUrls(clean, SIGNED_TTL_SECONDS)
  if (error || !data) return out
  data.forEach((row, i) => {
    if (row.signedUrl) out.set(clean[i], row.signedUrl)
  })
  return out
}
