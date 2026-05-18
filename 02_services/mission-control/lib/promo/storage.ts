// Promo Pulse — Phase 3 Storage helper.
//
// Bucket `promo` is created once via Supabase Studio (private). Assets are
// keyed by <slug>/<format_key>.<ext>. We re-upload on every generation
// (upsert=true) so regeneration replaces in place.
//
// Public-facing display uses signed URLs (24h) — the bucket stays private so
// drafts don't leak to the public internet.

import { sbPublic } from '@/lib/supabase'
import type { PromoFormatKey } from './visuals'
import type { RenderedAsset } from './render'

const BUCKET = 'promo'
const SIGNED_TTL_SECONDS = 60 * 60 * 24  // 24h — long enough for an editing session

function objectPath(campaignSlug: string, key: PromoFormatKey, ext: 'png' | 'pdf'): string {
  return `${campaignSlug}/${key}.${ext}`
}

const CONTENT_TYPE: Record<'png' | 'pdf', string> = {
  png: 'image/png',
  pdf: 'application/pdf',
}

export async function uploadAssets(
  campaignSlug: string,
  assets: RenderedAsset[],
): Promise<Record<PromoFormatKey, string>> {
  const out: Partial<Record<PromoFormatKey, string>> = {}

  for (const a of assets) {
    const objKey = objectPath(campaignSlug, a.key, a.ext)
    const { error } = await sbPublic.storage.from(BUCKET).upload(objKey, a.buffer, {
      contentType: CONTENT_TYPE[a.ext],
      upsert: true,
    })
    if (error) throw new Error(`Storage upload failed for ${objKey}: ${error.message}`)
    out[a.key] = objKey
  }
  return out as Record<PromoFormatKey, string>
}

// Resolve signed URLs for a set of object paths. Returns a map keyed by the
// SAME key as the input — convenient for splatting into <img src>.
export async function signAssetUrls(
  paths: Partial<Record<PromoFormatKey, string>>,
): Promise<Partial<Record<PromoFormatKey, string>>> {
  const entries = Object.entries(paths).filter((e): e is [PromoFormatKey, string] => !!e[1])
  if (entries.length === 0) return {}

  const out: Partial<Record<PromoFormatKey, string>> = {}
  // createSignedUrls is bulk; one call per generation is enough.
  const objPaths = entries.map(([, p]) => p)
  const { data, error } = await sbPublic.storage
    .from(BUCKET)
    .createSignedUrls(objPaths, SIGNED_TTL_SECONDS)
  if (error) throw new Error(`Failed to sign asset URLs: ${error.message}`)

  data.forEach((row, i) => {
    const [key] = entries[i]
    if (row.signedUrl) out[key] = row.signedUrl
  })
  return out
}
