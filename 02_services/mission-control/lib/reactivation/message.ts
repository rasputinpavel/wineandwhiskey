// Claude-backed reactivation message generator.
//
// Bilingual (en/ru), short, individual, with a required STOP opt-out line.
// One Anthropic call per Message-button click; Haiku because the output is
// brief and we want sub-second latency.
//
// The brief we hand Claude is richer than the previous version — it now
// includes a loyalty profile (does the customer keep buying the same SKU,
// or do they explore?) and a lifetime tier (VIP / regular / light), so the
// model can match tone without being told explicitly.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod/v4'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ReactivationCustomer, ReactivationProduct } from './data'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MessageSchema = z.object({
  message: z.string().min(100).max(1000).describe(
    "Short personal reactivation message for WhatsApp, in either English or Russian (whichever the brief specifies). 4–6 short sentences. Real paragraph breaks between thought groups. *Single asterisks* for bold. 1–2 subtle emojis only (🌧 / 🍷 / 🥂 / 🤍 — never decorate every line). No exclamation marks. No prices. MUST end with the language-appropriate STOP opt-out line and a 'Wine & Whiskey' signature on its own line.",
  ),
})

export type ReactivationMessageOutput = z.infer<typeof MessageSchema>

// ─── Name parsing ─────────────────────────────────────────────────────────
// Loyverse names come in either order — "Oleinikova Kseniia" (surname first,
// Russian-passport style) or "Benjamin Schoepfer" (given first, Western
// style). We detect Slavic surnames by their endings and pick the OTHER
// token as the given name. Falls back to the first token otherwise.
const SURNAME_RX = /(ova|eva|ina|skaya|ov|ev|in|sky|enko|yuk|uk|yan)$/i

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function pickGivenName(full: string): string {
  const tokens = full.trim().split(/\s+/).filter(t => /[\p{L}]/u.test(t))
  if (tokens.length === 0) return full
  if (tokens.length === 1) return titleCase(tokens[0])
  const surnameMatches = tokens.filter(t => SURNAME_RX.test(t))
  if (surnameMatches.length === 1) {
    const given = tokens.find(t => t !== surnameMatches[0])!
    return titleCase(given)
  }
  return titleCase(tokens[0])
}

// ─── Language detection ───────────────────────────────────────────────────
// We pick the message language from the customer's name. Strong signals
// only — if uncertain, fall through to English (universal default for our
// Phuket clientele). The reactivation list is small enough that the owner
// can override per-customer if the auto-detection misfires.
const SLAVIC_GIVEN_RX = /^(irina|olga|sergey|sergei|maria|maxim|maksim|aleksandr|alexander|aleksey|alexey|natalia|nadezhda|igor|vladimir|mikhail|tatiana|elena|yulia|julia|svetlana|anastasia|anastasiya|kseniia|kseniya|oksana|veronika|veronica|yuri|yury|eugene|evgeny|andrey|andrei|pavel|nikolai|nikolay|konstantin|stanislav|valeria|valeriia|halyna|galina|denis|dmitri|dmitry|nikita|roman|anton|artem|vasily|vasili|polina|katerina|ekaterina|alina|alyona|vita|nilova)$/i

function detectLanguage(fullName: string, givenName: string): 'ru' | 'en' {
  // Cyrillic characters anywhere → ru.
  if (/[Ѐ-ӿ]/.test(fullName)) return 'ru'
  const tokens = fullName.trim().split(/\s+/)
  // Any Slavic surname suffix on any token → ru.
  if (tokens.some(t => SURNAME_RX.test(t))) return 'ru'
  // Given name in the known-Slavic given-name list → ru.
  if (SLAVIC_GIVEN_RX.test(givenName)) return 'ru'
  return 'en'
}

// ─── Lapsed-time phrasing ─────────────────────────────────────────────────
function lapsedPhraseEn(days: number): string {
  if (days <= 10) return 'just a few days'
  if (days <= 17) return 'about a week'
  if (days <= 28) return 'a couple of weeks'
  if (days <= 45) return 'about a month'
  if (days <= 75) return 'a couple of months'
  if (days <= 150) return 'a few months'
  if (days <= 240) return 'over half a year'
  return 'a long while'
}
function lapsedPhraseRu(days: number): string {
  if (days <= 10) return 'несколько дней'
  if (days <= 17) return 'около недели'
  if (days <= 28) return 'пару недель'
  if (days <= 45) return 'около месяца'
  if (days <= 75) return 'пару месяцев'
  if (days <= 150) return 'несколько месяцев'
  if (days <= 240) return 'больше полугода'
  return 'давно'
}

// ─── Loyalty profile + lifetime tier ──────────────────────────────────────
// loyalist  — one or two SKUs dominate their basket → name THAT drink
// explorer  — wide spread across many SKUs → frame around taste/category
// balanced  — somewhere in between
type LoyaltyProfile = 'loyalist' | 'explorer' | 'balanced'

function loyaltyProfile(c: ReactivationCustomer): { profile: LoyaltyProfile; topShare: number } {
  const totalQty = c.topProducts.reduce((s, p) => s + Math.max(0, p.qty), 0)
  const topQty = Math.max(0, c.topProducts[0]?.qty ?? 0)
  const top3Qty = c.topProducts.slice(0, 3).reduce((s, p) => s + Math.max(0, p.qty), 0)
  const topShare = totalQty > 0 ? topQty / totalQty : 0
  const top3Share = totalQty > 0 ? top3Qty / totalQty : 0
  if (topShare >= 0.4) return { profile: 'loyalist', topShare }
  if (top3Share <= 0.35 && c.topProducts.length >= 6) return { profile: 'explorer', topShare }
  return { profile: 'balanced', topShare }
}

type LifetimeTier = 'vip' | 'regular' | 'light'
function lifetimeTier(c: ReactivationCustomer): LifetimeTier {
  if (c.totalSpent >= 30000 || c.receipts >= 15) return 'vip'
  if (c.totalSpent >= 8000  || c.receipts >= 5)  return 'regular'
  return 'light'
}

// ─── Pick what to mention ─────────────────────────────────────────────────
type Mention =
  | { kind: 'product'; name: string; category: string }
  | { kind: 'category'; category: string }

function pickMention(c: ReactivationCustomer): Mention {
  const inStockFav = c.topProducts.find(p => p.inStock === true)
  if (inStockFav) return { kind: 'product', name: inStockFav.name, category: inStockFav.category }
  return { kind: 'category', category: c.byCategory[0]?.category ?? 'wine' }
}

function inStockSummary(products: ReactivationProduct[]): string {
  const inStock = products.filter(p => p.inStock === true).slice(0, 3)
  if (inStock.length === 0) return '(none of their top buys is currently in stock)'
  return inStock.map(p => `${p.name} [in stock, bought ×${Math.round(p.qty)}]`).join('; ')
}

// ─── Prompt ───────────────────────────────────────────────────────────────
const SYSTEM = `You write SHORT, deeply personal reactivation messages for Wine & Whiskey — a small wine and whisky shop in Phuket that delivers bottles to customers' homes. The owner sends these by hand on WhatsApp.

LANGUAGE — pick from the brief, write the entire message in that ONE language. Never mix. The brief specifies "en" or "ru".

Voice (both languages):
- Warm, calm, personal. Like a familiar shopkeeper writing one specific person, not a marketer running a campaign.
- 4–6 short sentences total. Never longer. No filler. No exclamation marks. No hashtags. No "Dear Customer". No "We hope this finds you well".
- The given name from the brief MUST appear in the very first sentence. A message without the name reads as a mass blast and is a failure.
- Reference something CONCRETE from their history — name the specific drink or the category they actually buy. The loyalty profile in the brief tells you whether to lead with a specific SKU (loyalist) or with a category/style note (explorer).
- Lifetime tier sets the warmth dial: "vip" — write like you genuinely remember them; "regular" — friendly familiar; "light" — polite, not over-familiar.
- Never invent a discount, promo, price, or product the brief doesn't mention.
- Never mention a product unless the brief explicitly marks it [in stock]. If nothing is in stock, mention the category or the style they like.
- Include a brief, soft mention that it's rainy season on Phuket (en: "rainy season" / "the rain"; ru: "сезон дождей" / "дождь"). One natural sentence — not a weather report. Skip it only if it truly can't fit the message naturally.

Formatting:
- Use real blank lines between thought groups (2–3 short paragraphs is normal).
- *Single asterisks* for bold on the brand name first mention AND the specific drink or category mention. Nothing else bolded.
- Include the catalog URL exactly once, inline: *wine-whiskey.com/catalog* (lowercase, no protocol, no trailing slash, bolded with single asterisks).
- Order CTA: a single short line telling them to just reply to this message to order.

Emojis: 1–2 total, placed naturally, never decorating every line:
- 🌧 inside the rainy-season sentence — strong fit
- one of 🍷 / 🥂 / 🤍 near the pitch or close — optional, only if it feels right
- Never use 😀 / 🙂 / 👍 / 🎉 or any food emoji other than the wine ones above

REQUIRED CLOSING (one line, mandatory, in the message's language):
- English:  "If your tastes or plans have changed, or you'd rather not hear from us — just reply STOP and we won't message again."
- Russian:  "Если изменились вкусы или планы, или просто не хотите больше получать сообщения — ответьте СТОП, и мы больше не побеспокоим."

This opt-out line is non-negotiable — every message ends with it. Write it verbatim in the chosen language. It goes on its own paragraph just before the signature.

Sign off on its own line, after a blank line: "Wine & Whiskey" (no bold, no decoration).

If days_since_visit ≤ 14, do NOT mention a gap — they were just here; lead with the drink instead. Otherwise weave in the lapsed phrase naturally (don't read out the raw number).`

// ─── Main entry ───────────────────────────────────────────────────────────
export async function generateReactivationMessage(
  customer: ReactivationCustomer,
): Promise<string> {
  const givenName = pickGivenName(customer.name)
  const lang = detectLanguage(customer.name, givenName)
  const mention = pickMention(customer)
  const lapsed = lang === 'ru'
    ? lapsedPhraseRu(customer.daysSinceLastVisit)
    : lapsedPhraseEn(customer.daysSinceLastVisit)
  const stockLine = inStockSummary(customer.topProducts)
  const { profile, topShare } = loyaltyProfile(customer)
  const tier = lifetimeTier(customer)

  const loyaltyHint =
    profile === 'loyalist'
      ? `keeps coming back for one SKU (${Math.round(topShare * 100)}% of their bottles) — name that drink specifically`
      : profile === 'explorer'
      ? `wide-ranging taste — frame around their category or style, not one bottle`
      : `mixed pattern — pick whichever feels most natural from the brief`

  const tierHint =
    tier === 'vip'
      ? `VIP regular (₿${Math.round(customer.totalSpent).toLocaleString('en-US')} lifetime / ${customer.receipts} visits) — write like you genuinely remember them`
      : tier === 'regular'
      ? `established regular (₿${Math.round(customer.totalSpent).toLocaleString('en-US')} / ${customer.receipts} visits) — friendly familiar`
      : `light customer (₿${Math.round(customer.totalSpent).toLocaleString('en-US')} / ${customer.receipts} visits) — polite, don't over-claim familiarity`

  const briefLines = [
    `>>> Language for the entire message: ${lang}`,
    `>>> Given name (MUST appear in the first sentence): ${givenName}`,
    `Full name on file (for context only — do NOT address them by surname): ${customer.name}`,
    `Days since last visit: ${customer.daysSinceLastVisit}  → phrase as "${lapsed}" (or skip if ≤ 14)`,
    `Customer tier: ${tierHint}`,
    `Loyalty profile: ${profile} — ${loyaltyHint}`,
    `Top category by spend: ${customer.byCategory[0]?.category ?? 'wine'}`,
    `Top in-stock products from their history: ${stockLine}`,
    mention.kind === 'product'
      ? `Mention this specific product (in stock): ${mention.name}`
      : `No top buy is in stock. Mention the category/style instead: ${mention.category}`,
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
