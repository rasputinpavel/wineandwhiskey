// Promo Pulse — Phase 2 copywriter.
//
// One Anthropic call per promo. The design system (~8K tokens of brand voice,
// composition templates, forbidden words, palette) is cached via
// `cache_control: ephemeral` so every subsequent generation reads from cache
// at ~0.1× cost instead of re-uploading the prefix.
//
// Output is constrained to a Zod schema via messages.parse — no fragile
// post-hoc JSON parsing.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod/v4'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  PROMO_VISUAL_MODES, PROMO_COMPOSITIONS, PROMO_MOOD_LABEL,
  type PromoCampaign,
} from './types'

// ─── Output schema ─────────────────────────────────────────────────────────
// HARD constraints — schema validation rejects long output. The headline slot
// renders in display-xl Bebas Neue at ~120px, so 4 words / 24 chars is the
// absolute ceiling before it overflows the canvas.
const PromoCopySchema = z.object({
  headline:    z.string().max(24).describe('STRICT 1–4 words, ≤24 characters total. Examples: "BRUNELLO WEEK", "PROSECCO -10%", "PINK FRIDAY", "2 FOR 1", "BAROLO 2019". Will render UPPERCASE in Bebas Neue display font. Punchy, concrete, English. NEVER a full sentence.'),
  subhead:     z.string().max(80).describe('ONE short line, ≤80 characters. Describes the offer concretely. Example: "Tuscany, 2018. Buy two, third on us."'),
  caption_ig:  z.string().max(500).describe('Instagram caption — 1–3 short sentences, 0–1 emoji max, optional 3–5 thematic hashtags at end. English.'),
  caption_tg:  z.string().max(400).describe('Telegram/WhatsApp caption — 1–3 short sentences, no hashtags, no emoji. English.'),
  visual_mode: z.enum(PROMO_VISUAL_MODES).describe('"dark" = cinematic hero / single SKU / price; "light" = atmosphere / multi-glass / hands / Friday mood.'),
  composition: z.enum(PROMO_COMPOSITIONS).describe(
    'Pick one of 5 templates: vitrina (product hero), zayavka (text statement), moment (full-bleed action), kartochka (info card 2-col), tsena (price drop with big number).'
  ),
})

export type PromoCopyOutput = z.infer<typeof PromoCopySchema>

// ─── Cached static prefix ──────────────────────────────────────────────────
// Module-scoped — survives across hot-reloads within a single Node process.
let designSystemCache: string | null = null

async function loadDesignSystem(): Promise<string> {
  if (designSystemCache) return designSystemCache
  // Mirrored into public/brand/ by scripts/sync-brand-assets.mjs (prebuild/predev).
  const filePath = path.join(process.cwd(), 'public', 'brand', 'design-system.md')
  designSystemCache = await readFile(filePath, 'utf-8')
  return designSystemCache
}

const TASK_INSTRUCTIONS = `
You are the copywriter for Wine & Whiskey, an urban wine bar in Phuket. Your
job is to turn a weekly promo brief into ad copy that follows the brand's
design system (provided in full above: palette, composition templates,
typography tokens, tone-of-voice registers, forbidden words).

Rules — non-negotiable:

1. ENGLISH ONLY. Phuket is an international resort (design-system §6, §7).
2. Avoid forbidden words: "indulge yourself", "for true connoisseurs",
   "legendary", "iconic", "exclusive collection", "ideal for a romantic
   evening", emoji spam, hashtag spam.
3. Brand voice = "a knowledgeable friend who does not lecture". Concrete
   (region, grape, year, taste) over abstract ("exquisite", "premium").
4. Match the brief's mood:
     • direct  — fact about wine, new arrival
     • casual  — story, recommendation
     • light   — Friday, occasion, mood
     • expert  — region, producer, vintage details

Output fields:

• headline — STRICT 1–4 words, ≤24 characters TOTAL. This is non-negotiable.
  Examples that fit: "BRUNELLO WEEK", "PROSECCO -10%", "PINK FRIDAY",
  "BAROLO 2019", "2 FOR 1", "ROSÉ FRIDAY", "NEW: PIEDMONT".
  Examples that FAIL: "-10% for the 3rd bottle of prosecco" (too long, that
  belongs in subhead), "Discount on Prosecco bottles this week" (sentence).
  The headline must fit on one line in 100px display type.
• subhead — single line ≤ 80 chars. One concrete sentence. This is where the
  mechanic explanation lives, NOT in the headline.
• caption_ig — 1–3 short sentences + optional 3–5 thematic hashtags.
• caption_tg — 1–3 short sentences, no hashtags, no emoji.
• visual_mode + composition — be opinionated. Pick the pair that best
  fits the brief. Guidance:
    - New SKU spotlight     → dark + vitrina  (product hero)
    - Theme week / event    → dark or light + zayavka
    - Atmosphere / Friday   → light + moment or zayavka
    - "If you like X, try Y"→ light or dark + kartochka
    - Price drop / -20% off → dark + tsena    (big number)
`.trim()

// ─── Main entry ────────────────────────────────────────────────────────────
const client = new Anthropic()

export async function generatePromoCopy(c: PromoCampaign): Promise<PromoCopyOutput> {
  const designSystem = await loadDesignSystem()

  const brief = [
    `Theme: ${c.theme}`,
    `Mechanic: ${c.mechanic}`,
    `Dates: ${c.starts_on} → ${c.ends_on}`,
    `Mood: ${PROMO_MOOD_LABEL[c.mood]}`,
    `Featured products (slug = filename in 04_brand/products/): ${c.sku_slugs.join(', ')}`,
  ].join('\n')

  const response = await client.messages.parse({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    // System prompt is the cached prefix — design-system + task instructions
    // are stable, so they hit cache on every subsequent call.
    system: [
      {
        type: 'text',
        text: `# Wine & Whiskey Design System\n\n${designSystem}\n\n---\n\n# Your Task\n\n${TASK_INSTRUCTIONS}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: `Promo brief:\n\n${brief}\n\nWrite the promo copy block now.`,
    }],
    output_config: {
      format: zodOutputFormat(PromoCopySchema),
      effort: 'high',
    },
  })

  if (!response.parsed_output) {
    throw new Error(
      `Anthropic returned no parsed output (stop_reason=${response.stop_reason})`
    )
  }
  return response.parsed_output
}
