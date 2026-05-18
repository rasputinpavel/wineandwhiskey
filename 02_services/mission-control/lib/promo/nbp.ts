// Promo Pulse — Nano Banana Pro background generator (Phase 3.5+).
//
// Prompts are NOT hardcoded here — they're written per-campaign by Claude
// in Phase 2 (see lib/promo/copy.ts → nbp_prompt field) and read from the
// campaign row. This file is now just a thin Gemini client + retry logic.

import { GoogleGenAI } from '@google/genai'
import type { PromoCampaign } from './types'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

// 3 aspect families cover all 7 output formats.
export type BgAspect = 'square' | 'portrait' | 'landscape'

const ASPECT_TO_NBP: Record<BgAspect, '1:1' | '9:16' | '16:9'> = {
  square:    '1:1',
  portrait:  '9:16',
  landscape: '16:9',
}

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview'

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function isTransient(err: unknown): boolean {
  const msg = (err as Error)?.message ?? ''
  return /\b(503|500|UNAVAILABLE|overloaded|high demand)\b/i.test(msg)
}

export async function generateBackground(prompt: string, aspect: BgAspect): Promise<Buffer> {
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
      if (!isTransient(e)) break
      if (attempt < delays.length - 1) await sleep(delays[attempt])
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export async function generateAllBackgrounds(
  c: PromoCampaign,
): Promise<Record<BgAspect, string>> {
  if (!c.nbp_prompt) {
    throw new Error('Campaign has no nbp_prompt — run "Generate copy" first to author it')
  }
  const aspects: BgAspect[] = ['square', 'portrait', 'landscape']

  const results = await Promise.all(
    aspects.map(async aspect => {
      const buf = await generateBackground(c.nbp_prompt!, aspect)
      return [aspect, `data:image/png;base64,${buf.toString('base64')}`] as const
    }),
  )
  return Object.fromEntries(results) as Record<BgAspect, string>
}
