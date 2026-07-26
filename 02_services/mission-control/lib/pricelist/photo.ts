import 'server-only'
import { removeBackground } from '@imgly/background-removal-node'
import sharp from 'sharp'
import { sbPublic, sbMarketing } from '@/lib/supabase'

const BUCKET = 'product-images'

// Remove the background from an uploaded bottle screenshot, tight-crop the
// subject (mirrors 03_automation/lift_subject.py), and upload the transparent
// PNG to Supabase Storage. Returns the public URL.
export async function removeBgAndUpload(input: Buffer, mime: string, base: string): Promise<string> {
  const cut = await removeBackground(new Blob([new Uint8Array(input)], { type: mime || 'image/png' }))
  const cutBuf = Buffer.from(await cut.arrayBuffer())

  // Tight crop to the non-transparent subject, small transparent padding.
  const trimmed = await sharp(cutBuf)
    .trim()
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const key = `${base}-${crypto.randomUUID().slice(0, 8)}.png`
  const { error } = await sbPublic.storage.from(BUCKET).upload(key, trimmed, {
    contentType: 'image/png', upsert: true,
  })
  if (error) throw error
  return sbPublic.storage.from(BUCKET).getPublicUrl(key).data.publicUrl
}

// Persist a SKU's chosen photo. `image_url` = uploaded/Storage shot (wins);
// `image_slug` = a picked library file. Passing null clears a field.
export async function setSkuPhoto(code: string, patch: { image_url?: string | null; image_slug?: string | null }): Promise<void> {
  const { error } = await sbMarketing.from('sku_enrichment').upsert(
    { loyverse_product_code: code, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'loyverse_product_code' },
  )
  if (error) throw error
}
