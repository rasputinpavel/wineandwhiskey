import type { WineCard, WineColor } from './types'

// 4-step wizard model. Each step writes one field of WizardAnswers; recommend()
// scores wines against the answers and returns the top N. Keep the scoring
// transparent — it's a heuristic, not ML.

export type WizardAnswers = {
  color:  WineColor | null
  taste:  TasteKey | null    // adapts by color, mapped to body/sweetness signals
  food:   FoodKey  | null    // null = "just to sip" / skipped
  budget: BudgetKey | null
}

export type TasteKey  = 'light_fruity' | 'medium' | 'bold_robust'  // red
                       | 'crisp_dry'   | 'aromatic' | 'rich_oaked' // white
                       | 'dry' | 'off_dry' | 'sweet'               // rose / sparkling fallback
export type FoodKey   = 'thai' | 'seafood' | 'red_meat' | 'cheese' | 'sip'
export type BudgetKey = 'low' | 'mid' | 'high' | 'any'

export const BUDGET_CAPS: Record<BudgetKey, number | null> = {
  low:  1500,
  mid:  3000,
  high: 6000,
  any:  null,
}

export const TASTE_OPTIONS_BY_COLOR: Record<WineColor, { key: TasteKey; label: string; hint: string }[]> = {
  red: [
    { key: 'light_fruity', label: 'Light & fruity', hint: 'Pinot Noir style' },
    { key: 'medium',       label: 'Medium',         hint: 'Merlot / Sangiovese' },
    { key: 'bold_robust',  label: 'Bold & robust',  hint: 'Cabernet / Malbec' },
  ],
  white: [
    { key: 'crisp_dry',  label: 'Crisp & dry',  hint: 'Sauvignon Blanc' },
    { key: 'aromatic',   label: 'Aromatic',     hint: 'Riesling / Gewürz' },
    { key: 'rich_oaked', label: 'Rich & oaked', hint: 'Chardonnay' },
  ],
  rose: [
    { key: 'dry',     label: 'Dry',      hint: 'Provence style' },
    { key: 'off_dry', label: 'Off-dry',  hint: 'A touch of fruit' },
  ],
  sparkling: [
    { key: 'dry',     label: 'Brut',     hint: 'Dry' },
    { key: 'off_dry', label: 'Off-dry',  hint: 'Extra Dry / Sec' },
    { key: 'sweet',   label: 'Sweet',    hint: 'Demi-Sec / Moscato' },
  ],
  orange: [
    { key: 'medium', label: 'Any', hint: '' },
  ],
}

export const FOOD_OPTIONS: { key: FoodKey; label: string; hint: string }[] = [
  { key: 'thai',     label: 'Thai food',          hint: 'spicy, herbal' },
  { key: 'seafood',  label: 'Seafood',            hint: 'oysters, fish, prawns' },
  { key: 'red_meat', label: 'Red meat',           hint: 'steak, lamb, BBQ' },
  { key: 'cheese',   label: 'Cheese & charcuterie', hint: '' },
  { key: 'sip',      label: 'Just to sip',        hint: 'no food in mind' },
]

const BODY_LIGHT = ['light', 'light bodied', 'light-bodied']
const BODY_MED   = ['medium', 'medium bodied', 'medium-bodied']
const BODY_FULL  = ['full', 'full bodied', 'full-bodied', 'bold']

function bodyBucket(body: string | null): 'light' | 'medium' | 'full' | null {
  if (!body) return null
  const b = body.toLowerCase()
  if (BODY_LIGHT.some(t => b.includes(t))) return 'light'
  if (BODY_FULL.some(t => b.includes(t)))  return 'full'
  if (BODY_MED.some(t => b.includes(t)))   return 'medium'
  return null
}

const FOOD_KEYWORDS: Record<FoodKey, string[]> = {
  thai:     ['spicy', 'thai', 'asian', 'curry'],
  seafood:  ['seafood', 'fish', 'shellfish', 'oyster', 'prawn', 'shrimp'],
  red_meat: ['beef', 'lamb', 'steak', 'red meat', 'game', 'pork', 'barbecue', 'bbq'],
  cheese:   ['cheese', 'charcuterie'],
  sip:      [],
}

export function recommend(wines: WineCard[], a: WizardAnswers, limit = 3): WineCard[] {
  let pool = wines.filter(w => w.qty > 0)
  if (a.color)  pool = pool.filter(w => w.color === a.color)
  if (a.budget) {
    const cap = BUDGET_CAPS[a.budget]
    if (cap != null) pool = pool.filter(w => (w.price_thb ?? 0) <= cap)
  }

  type Scored = { w: WineCard; score: number }
  const scored: Scored[] = pool.map(w => {
    let score = 0

    // Vivino rating is the dominant prior (0..5 → 0..50).
    if (w.vivino_rating != null) score += w.vivino_rating * 10

    // Taste bucket via body proxy.
    const bb = bodyBucket(w.body)
    if (a.taste === 'light_fruity' && bb === 'light')   score += 20
    if (a.taste === 'medium'       && bb === 'medium')  score += 20
    if (a.taste === 'bold_robust'  && bb === 'full')    score += 20
    if (a.taste === 'rich_oaked'   && bb === 'full')    score += 15
    if (a.taste === 'crisp_dry'    && bb === 'light')   score += 15

    // Food pairing match via Vivino food_pairings text.
    if (a.food && a.food !== 'sip') {
      const kw = FOOD_KEYWORDS[a.food]
      const hay = w.food_pairings.join(' ').toLowerCase()
      if (kw.some(k => hay.includes(k))) score += 25
    }

    return { w, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(s => s.w)
}
