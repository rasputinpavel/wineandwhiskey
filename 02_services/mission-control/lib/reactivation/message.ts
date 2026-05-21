// Claude-backed reactivation message generator.
//
// Takes a snapshot of a single customer (name + top products + last visit)
// and asks Claude Haiku to write a short, warm English message we can paste
// into WhatsApp / Telegram. The brand voice is described inline — this is a
// 1:1 outreach message, not ad copy, so we don't load the full design system
// prefix (different register: friendly + personal, not display copy).
//
// One call per customer. We use Haiku because the output is short (≤ ~80
// words) and we want sub-second latency on the button click.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ReactivationCustomer, ReactivationProduct } from './data'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MessageSchema = z.object({
  message: z.string().min(40).max(500).describe(
    "Plain-text English reactivation message. 2–4 short sentences. No emojis. Friendly, brand-spoken, never pushy. End with an offer (in stock + delivery). Don't quote prices. Don't use exclamation marks."
  ),
})

export type ReactivationMessageOutput = z.infer<typeof MessageSchema>

function topThree(products: ReactivationProduct[]): string {
  return products.slice(0, 3).map(p => `${p.name} (×${Math.round(p.qty)})`).join('; ')
}
function topCategory(c: ReactivationCustomer): string {
  return c.byCategory[0]?.category ?? 'wine'
}

const SYSTEM = `You write 1:1 reactivation messages for Wine & Whiskey — a small wine and whisky bar in Phuket that also delivers bottles to customers' homes. The owner Pavel is sending these by hand on WhatsApp or Telegram.

Brand voice — non-negotiable:
- Warm, calm, friendly. Like a familiar shopkeeper who remembers you, not a marketer.
- Short. 2–4 sentences total. No filler.
- English only. No transliteration. No emojis. No exclamation marks. No hashtags. No "Dear Customer". No "We hope this finds you well".
- Never invent a discount, promo, price, or product the brief doesn't mention.
- Reference the customer's actual favourite drink or category by name — that is the whole point of the message.
- End on a soft offer: it's in stock and we can deliver to their home.
- Sign off as "Wine & Whiskey" (no "Team", no name, no signature block).

Structure (do not name these sections; just follow the flow):
1. Greeting with first name.
2. One sentence noting it's been a while (use the days-since-visit naturally; "a few weeks", "almost a month", "couple of months" — don't read out the raw number).
3. One sentence about the favourite drink / category, framed as "we have it in stock right now" or "the new vintage just arrived" if relevant.
4. Soft close: offer to deliver to their home.`

const FIRST_NAME_RX = /^[\p{L}\p{M}'’-]+/u
function firstName(full: string): string {
  const m = full.trim().match(FIRST_NAME_RX)
  if (!m) return full
  // Title-case (first uppercase, rest lowercase) — Loyverse names come in mixed casing.
  const s = m[0]
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function lapsedPhrase(days: number): string {
  if (days < 21) return 'a couple of weeks'
  if (days < 45) return 'about a month'
  if (days < 75) return 'a couple of months'
  if (days < 150) return 'a few months'
  if (days < 240) return 'over half a year'
  return 'a long while'
}

export async function generateReactivationMessage(
  customer: ReactivationCustomer,
): Promise<string> {
  const top3 = topThree(customer.topProducts)
  const cat = topCategory(customer)
  const brief = [
    `Customer first name: ${firstName(customer.name)}`,
    `Days since last visit: ${customer.daysSinceLastVisit} (phrase it naturally as "${lapsedPhrase(customer.daysSinceLastVisit)}")`,
    `Top category by spend: ${cat}`,
    `Top 3 products (most-bought first): ${top3 || '(none on file)'}`,
    `Pick ONE concrete drink or the category to mention — whichever sounds most natural. If the top product looks like a generic beer or food item, fall back to the category instead.`,
  ].join('\n')

  const res = await anthropic.messages.parse({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      { role: 'user', content: `Write the message for:\n\n${brief}` },
    ],
    output_config: {
      format: zodOutputFormat(MessageSchema),
    },
  })

  const parsed = res.parsed_output
  if (!parsed) {
    throw new Error(
      `Claude returned no parsed output (stop_reason=${res.stop_reason})`,
    )
  }
  return parsed.message.trim()
}
