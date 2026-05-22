// Claude-backed reactivation message generator.
//
// Takes a snapshot of a single customer (name + top products + last visit)
// and asks Claude Haiku to write a short, warm English message we can paste
// into WhatsApp / Telegram.
//
// One call per customer. We use Haiku because the output is short and we
// want sub-second latency on the button click.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ReactivationCustomer, ReactivationProduct } from './data'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MessageSchema = z.object({
  message: z.string().min(120).max(1000).describe(
    "WhatsApp-formatted English reactivation message. Use real line breaks for paragraphs, *single asterisks* for bold (WhatsApp's bold syntax), and 1-2 subtle emojis placed naturally (NOT decorating every line). No exclamation marks. No prices. Must include the URL wine-whiskey.com/catalog and an instruction to reply to the message to order."
  ),
})

export type ReactivationMessageOutput = z.infer<typeof MessageSchema>

// ─── Name parsing ─────────────────────────────────────────────────────────
// Loyverse names come in either order — "Oleinikova Kseniia" (surname first,
// Russian-passport style) or "Benjamin Schoepfer" (given first, Western style).
// We detect Slavic surnames by their endings and pick the OTHER token as the
// given name. Falls back to the first token if no surname-shaped token is found.
//
// Patterns: -ov / -ev / -in + optional -a (Russian); -sky / -skaya (Polish);
// -enko (Ukrainian); -yuk / -uk; -yan (Armenian).
const SURNAME_RX = /(ova|eva|ina|skaya|ov|ev|in|sky|enko|yuk|uk|yan)$/i

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function pickGivenName(full: string): string {
  const tokens = full.trim().split(/\s+/).filter(t => /[\p{L}]/u.test(t))
  if (tokens.length === 0) return full
  if (tokens.length === 1) return titleCase(tokens[0])
  // If exactly one token looks like a surname, the other is the given name.
  const surnameMatches = tokens.filter(t => SURNAME_RX.test(t))
  if (surnameMatches.length === 1) {
    const given = tokens.find(t => t !== surnameMatches[0])!
    return titleCase(given)
  }
  // Western default — first token is the given name.
  return titleCase(tokens[0])
}

// ─── Lapsed-time phrasing ─────────────────────────────────────────────────
// Buckets are deliberately granular for short windows so we never tell a
// 5-day-ago customer "a couple of weeks".
function lapsedPhrase(days: number): string {
  if (days <= 10) return 'just a few days'
  if (days <= 17) return 'about a week'
  if (days <= 28) return 'a couple of weeks'
  if (days <= 45) return 'about a month'
  if (days <= 75) return 'a couple of months'
  if (days <= 150) return 'a few months'
  if (days <= 240) return 'over half a year'
  return 'a long while'
}

// ─── Pick what to mention ─────────────────────────────────────────────────
// Prefer a specific in-stock product the customer has actually bought; if
// none of their top buys is currently in stock, fall back to the category.
type Mention =
  | { kind: 'product'; name: string; category: string }
  | { kind: 'category'; category: string }

function pickMention(c: ReactivationCustomer): Mention {
  const inStockFav = c.topProducts.find(p => p.inStock === true)
  if (inStockFav) {
    return { kind: 'product', name: inStockFav.name, category: inStockFav.category }
  }
  const cat = c.byCategory[0]?.category ?? 'wine'
  return { kind: 'category', category: cat }
}

function inStockSummary(products: ReactivationProduct[]): string {
  const inStock = products.filter(p => p.inStock === true).slice(0, 3)
  if (inStock.length === 0) return '(none of their top buys is currently in stock)'
  return inStock.map(p => `${p.name} [in stock]`).join('; ')
}

const SYSTEM = `You write personal reactivation messages for Wine & Whiskey — a small wine and whisky shop in Phuket that delivers bottles to customers' homes. The owner is sending these by hand on WhatsApp.

Voice — non-negotiable:
- Warm, calm, friendly. Like a familiar shopkeeper who remembers a regular, not a marketer.
- English only. No transliteration. No exclamation marks. No hashtags. No "Dear Customer". No "We hope this finds you well".
- Never invent a discount, promo, or product the brief doesn't mention.
- Never mention a product unless the brief explicitly marks it [in stock]. If nothing is in stock, mention the category instead.
- Address the customer by their GIVEN NAME (first name). The brief tells you which one it is.

WhatsApp formatting — required:
- **Paragraphs**: use real blank lines between the 3 paragraph groups described below. The message must NOT be one wall of text.
- **Bold** with single asterisks: *Wine & Whiskey* on its first mention; the customer's favourite product name OR category mention; and the catalog URL. Nothing else bolded.
- **Emojis**: 1–2 total, placed naturally. Good fits: 🌧 in the rainy-season bridge, and one of 🍷 / 🥂 / 🤍 near the pitch or close. Never sprinkle one on every line. Never use 😀 / 🙂 / 👍 / 🎉 or food emojis other than wine.

Message must follow this exact 6-part flow, grouped into THREE paragraphs separated by blank lines.

PARAGRAPH 1 — greeting + relationship:
1. Greeting line: "Warm greetings from *Wine & Whiskey*, a wine and whisky shop in Phuket." (verbatim or very close — this is our standard opener; *Wine & Whiskey* must be bolded with single asterisks)
2. A short line thanking them for being one of our regulars (vary the wording — "we're glad to have you among our regulars", "it's always been a pleasure having you stop by", etc.). Then, ONLY IF days_since_visit > 14, add a small note that it's been <lapsed_phrase> since we saw them. If days_since_visit ≤ 14, skip the "it's been a while" note — they were just here.

PARAGRAPH 2 — weather bridge + pitch:
3. Low-season bridge: acknowledge that it's low season on Phuket and the rain doesn't always make you want to leave home. One sentence. Place 🌧 naturally inside this sentence. Examples (vary, don't copy): "We know low season is in full swing 🌧 and the rain makes it easy to stay in." Do NOT use the words "monsoon" or "weather report" tone.
4. The pitch: a bottle of their favourite [drink or category] can brighten any weather, and it's in stock right now. The specific drink name OR the category mention must be bolded with single asterisks. Optionally finish this sentence with one wine emoji (🍷 / 🥂) if it feels natural.

PARAGRAPH 3 — catalog + CTA:
5. Catalog pointer: tell them they can browse the full stock list any time at *wine-whiskey.com/catalog* (write the URL exactly like that — lowercase, no protocol, no trailing slash — and bold it with single asterisks).
6. Order CTA + close: tell them ordering is simple — just reply to this message and we'll deliver to their door. Keep it one sentence.

Sign off on its own line, after a blank line, as exactly: "Wine & Whiskey" (no bold here, no emoji).

Total length: 6–8 short sentences across 3 paragraphs + signature. Keep it human, never robotic. Never read out the raw day count.`

export async function generateReactivationMessage(
  customer: ReactivationCustomer,
): Promise<string> {
  const givenName = pickGivenName(customer.name)
  const mention = pickMention(customer)
  const lapsed = lapsedPhrase(customer.daysSinceLastVisit)
  const stockLine = inStockSummary(customer.topProducts)

  const briefLines = [
    `Customer given name (use this, NOT a surname): ${givenName}`,
    `Full name on file (for context only — do not address them by surname): ${customer.name}`,
    `Days since last visit: ${customer.daysSinceLastVisit}  → phrase naturally as "${lapsed}"`,
    `Skip the "it's been a while" note? ${customer.daysSinceLastVisit <= 14 ? 'YES — they were just here, do not mention any gap' : 'no — mention it briefly'}`,
    `Top category by spend: ${customer.byCategory[0]?.category ?? 'wine'}`,
    `Top in-stock products from their history: ${stockLine}`,
    mention.kind === 'product'
      ? `MENTION THIS PRODUCT (it is in stock right now): ${mention.name}`
      : `No top buy is in stock. MENTION THE CATEGORY instead: ${mention.category}`,
  ]

  const res = await anthropic.messages.parse({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    system: SYSTEM,
    messages: [
      { role: 'user', content: `Write the message for:\n\n${briefLines.join('\n')}` },
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
