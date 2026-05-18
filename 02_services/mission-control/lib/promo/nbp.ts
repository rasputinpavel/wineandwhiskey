// Promo Pulse — Nano Banana Pro background generator.
//
// Generates 3 atmospheric backgrounds per promo (one per aspect family:
// square, portrait, landscape) using Gemini 3 Pro Image. Backgrounds are
// composited under product PNGs + design-system text via the HTML pipeline
// — so the model is instructed to produce EMPTY-OF-PRODUCT atmospheric
// scenes (glasses, liquid, light, shadows — no bottles, no labels, no text,
// no faces).
//
// Brand visual style is documented in 04_brand/design-system.md §5 and §6.
// Prompts here mirror those instructions.

import { GoogleGenAI } from '@google/genai'
import type { PromoCampaign, PromoVisualMode } from './types'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

// 3 aspect families cover all 7 output formats.
export type BgAspect = 'square' | 'portrait' | 'landscape'

const ASPECT_TO_NBP: Record<BgAspect, '1:1' | '9:16' | '16:9'> = {
  square:    '1:1',
  portrait:  '9:16',
  landscape: '16:9',
}

// ─── Prompts ───────────────────────────────────────────────────────────────
// Two base scenes — Dark (cinematic, product-hero mood) and Light (casual,
// alive, geometric shadow signature). Both end with explicit exclusions so
// the AI doesn't add bottles that would compete with the product overlay.

const EXCLUSIONS = `
STRICT EXCLUSIONS — NEVER include any of these:
- No bottles. No wine bottles, no whiskey bottles, no labels of any kind.
- No text, no letters, no numbers, no logos, no signage.
- No faces, no eyes, no full bodies, no people in frame.
- No restaurant table settings with cutlery, napkin folds, or place mats.
- No cartoon, vector, flat-design, or illustrative styles.
- No bright neon, no vivid synthetic colors.
`.trim()

function darkPrompt(): string {
  return `
Editorial product photography for a wine bar. Cinematic close-up scene.

Subject: Three empty wine glasses arranged at varying heights and angles on a
dark surface. Rich ruby and amber liquid catches the light at the bottom of
two glasses; one glass is empty with light passing through. Liquid surface
is glossy and shows highlights.

Lighting: Single warm key light from camera-left at 45 degrees, creating
deep shadows that fall to the right of the glasses. Amber-gold highlights
(#C9A84C) trace the rim and stem of each glass.

Surface: Matte black surface (#1A1A1A), faint texture — could be dark
marble or oiled wood. Reflections of glass bases barely visible.

Background: Deep matte black (#1A1A1A), softly out of focus. Slight bokeh
suggesting a wine bar environment but no recognizable objects.

Atmosphere: Intimate, late evening, cinematic. Shallow depth of field
focused on the glass stems. Urban-casual wine bar mood.

Composition: Leave the center-right area relatively uncluttered — a hero
product will be overlaid there in post.

${EXCLUSIONS}

Style: Photorealistic. Editorial product photography.
`.trim()
}

function lightPrompt(): string {
  return `
Editorial lifestyle photography for a wine bar. Hard afternoon sunlight
scene.

Subject: Three to four wine glasses standing on a light surface, holding
small amounts of richly colored liquid (red, rosé, white, amber).
Glasses are different heights and styles, arranged casually — not
symmetrically.

Lighting: Hard directional sunlight at a low afternoon angle, casting
LONG geometric shadows from the glass stems and bases onto the surface.
The shadow pattern is the main visual element — repeating ovals and lines
across the surface.

Surface: Light travertine or pale stone, warm cream tone (#EDE0D0 to
#F5F0EB), natural texture visible. Slight surface imperfections give
character.

Background: Out-of-focus wash of warm white and pale stone — suggests an
open daytime space, not an interior.

Atmosphere: Alive, casual, warm afternoon, good-company mood. Urban
wine-bar vibe. Slightly off-axis composition, not centered.

Composition: Leave the upper-center area uncluttered — a hero product
will be overlaid there in post.

${EXCLUSIONS}

Style: Photorealistic. Editorial lifestyle photography.
`.trim()
}

// ─── Model ─────────────────────────────────────────────────────────────────
// Nano Banana Pro (Gemini 3 Pro Image). Paid tier — no silent fallback to
// other models on failure (lower-tier models produce noticeably different
// imagery and shouldn't replace NBP without the user's say-so).
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function isTransient(err: unknown): boolean {
  const msg = (err as Error)?.message ?? ''
  // 503 = UNAVAILABLE, 500 = generic server fault — retryable.
  // 429 quotas are NOT retried automatically — caller learns about the limit.
  return /\b(503|500|UNAVAILABLE|overloaded|high demand)\b/i.test(msg)
}

// ─── Main entry ────────────────────────────────────────────────────────────
export async function generateBackground(
  mode: PromoVisualMode,
  aspect: BgAspect,
): Promise<Buffer> {
  const prompt = mode === 'dark' ? darkPrompt() : lightPrompt()
  const delays = [2000, 5000, 10000]
  let lastErr: unknown

  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseModalities: ['Image'],
          imageConfig: { aspectRatio: ASPECT_TO_NBP[aspect] },
        },
      })
      const parts = response.candidates?.[0]?.content?.parts ?? []
      for (const part of parts) {
        if (part.inlineData?.data) return Buffer.from(part.inlineData.data, 'base64')
      }
      throw new Error('No image bytes returned — likely a safety block')
    } catch (e) {
      lastErr = e
      if (!isTransient(e)) break  // Permanent error — surface immediately.
      if (attempt < delays.length - 1) await sleep(delays[attempt])
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

// Generate all three aspect ratios for a campaign. Returns a map of aspect
// → data URL so the HTML template can use them directly as CSS bg-image.
export async function generateAllBackgrounds(
  c: PromoCampaign,
): Promise<Record<BgAspect, string>> {
  const mode = c.visual_mode ?? 'dark'
  const aspects: BgAspect[] = ['square', 'portrait', 'landscape']

  // Parallel — independent API calls, ~5-10s each, doing them sequentially
  // would triple wall time.
  const results = await Promise.all(
    aspects.map(async aspect => {
      const buf = await generateBackground(mode, aspect)
      return [aspect, `data:image/png;base64,${buf.toString('base64')}`] as const
    }),
  )
  return Object.fromEntries(results) as Record<BgAspect, string>
}
