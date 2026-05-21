#!/usr/bin/env node
// One-shot generator for the reactivation campaign banner.
//
// Drops a square 1080×1080 image into 05_creative/output/ — the predev/prebuild
// sync-brand-assets.mjs hook mirrors it into public/creative/ so the portal
// can serve it as a static asset. Re-run when the seasonal hook changes
// (rainy season → high season → etc.).
//
// Usage:  GEMINI_API_KEY=... node 02_services/mission-control/scripts/gen-reactivation-banner.mjs

import { GoogleGenAI } from '@google/genai'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot  = path.resolve(__dirname, '../../..')

// Load .env.local from repo root if GEMINI_API_KEY isn't already in env.
if (!process.env.GEMINI_API_KEY) {
  const { config } = await import('dotenv')
  config({ path: path.join(repoRoot, '.env.local') })
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-3-pro-image-preview'

const SLUG = 'reactivation-rainy-season'
const DATE = new Date().toISOString().slice(0, 7)   // YYYY-MM — seasonal asset, monthly granularity is fine
const OUT_DIR  = path.join(repoRoot, '05_creative/output')
const OUT_NAME = `${SLUG}_${DATE}.png`

const PROMPT = `
A square brand image for Wine & Whiskey — a small wine and whisky shop in Phuket. Mood: rainy season in Phuket, low season, a slow soft afternoon. Atmosphere is hopeful and inviting, not gloomy.

Scene: looking into a small wine shop interior, intimate and warm. Foreground: a polished light travertine bar surface in warm cream tones with subtle natural veining. A single empty crystal wine glass sits on the bar at the left, faint condensation. Background right: a tall window taking up the right third of the frame. Heavy raindrops streak down the glass; outside is a blurred grey Phuket street with soft palm silhouettes and warm bokeh of distant lights, late afternoon golden hour filtering through the rain.

Composition: the CENTER of the image is a clearly empty cylindrical spotlight on the bar — a pool of soft warm light from above, ready to host a wine bottle that is intentionally not there. This empty placeholder is the focal point. The pool of light is approximately 1/4 of the image height, centred, with the wine glass just to its left for scale. No bottle, no shadow of a bottle, no implied bottle — just the empty waiting circle of light.

Typography (rendered cleanly, no spelling errors):
- Top-left corner: the words "rainy season" in elegant hand-written serif italic script, small, in deep wine red.
- Bottom-centre, below the empty spotlight: "with love from Wine & Whiskey" in restrained classic sans-serif, tracked uppercase letterspacing, smaller still, in soft graphite.

Colour palette: warm cream travertine, deep wine red (#722F37), soft graphite, ivory highlights. No neon, no bright blue, no oranges. Lighting: warm tungsten interior + cool soft grey from the rainy window — the two temperatures meet on the bar surface. Texture: filmic, very subtle 35mm grain, slight depth-of-field bokeh on the window side.

NO people. No faces. No hands. No labels on the glass. No price tags. No fruit. No flowers. No food. No additional text beyond the two phrases above.

Square aspect, 1:1.
`.trim()

console.log(`[banner] model=${MODEL}, slug=${SLUG}, date=${DATE}`)
console.log(`[banner] prompt length: ${PROMPT.length} chars`)

const t0 = Date.now()
const response = await ai.models.generateContent({
  model: MODEL,
  contents: PROMPT,
  config: {
    responseModalities: ['Image'],
    imageConfig: { aspectRatio: '1:1' },
  },
})
const dt = Date.now() - t0
console.log(`[banner] gemini responded in ${(dt / 1000).toFixed(1)}s`)

const parts = response.candidates?.[0]?.content?.parts ?? []
let imgBytes = null
for (const part of parts) {
  if (part.inlineData?.data) {
    imgBytes = Buffer.from(part.inlineData.data, 'base64')
    break
  }
}
if (!imgBytes) {
  console.error('[banner] no image bytes returned — safety block or empty response')
  for (const p of parts) console.error('  part:', Object.keys(p), p.text ?? '')
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })
const outPath = path.join(OUT_DIR, OUT_NAME)
await writeFile(outPath, imgBytes)
console.log(`[banner] wrote ${outPath} (${(imgBytes.length / 1024).toFixed(0)} KB)`)
