import { STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'
import { COUNTRIES, GRAPES, countryOption, grapeGroup, grapeOption, regionsFor } from './wine-data'
import type { CategoryKey, Option, OptionSet, WineFacts } from './types'

// How many buttons a guest sees per category. Fixed across difficulties —
// difficulty only moves the hint schedule (see hints.ts).
//
// THE RULE: every count must be >= its category's multiplier. Betting A chips
// on a uniform blind guess returns A*(m - n)/n, so m > n makes ignorance
// profitable. With region at 4 buttons paying x8, and vintage at 5 paying x10,
// a guest who knew nothing about wine and mashed those two every round doubled
// their stake in expectation and beat anyone who actually tasted. The
// invariant test below locks this down.
export const OPTION_COUNTS: Record<CategoryKey, number> = {
  style:   4,
  world:   2,
  country: 6,
  grape:   6,
  region:  8,
  vintage: 10,
}

const STYLE_VALUES = new Set(STYLE_OPTIONS.map(o => o.value))

type Rng = () => number

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function withDistractors(correct: Option, pool: readonly Option[], count: number, rng: Rng): Option[] {
  const decoys = shuffle(pool.filter(o => o.value !== correct.value), rng).slice(0, count - 1)
  return shuffle([correct, ...decoys], rng)
}

/** `count` consecutive years containing the true one, at a random offset so the
 *  answer is not always in the middle. Ascending, because a jumbled list of
 *  years is just annoying to read on a phone.
 *
 *  The window never runs past the current year: a vintage that has not happened
 *  yet is an obvious non-answer and hands the guest a free elimination, which
 *  is exactly the edge the option counts above exist to remove. `thisYear` is a
 *  parameter so the function stays pure and testable. */
function vintageWindow(vintage: number, count: number, rng: Rng, thisYear: number): number[] {
  const drift = Math.floor(rng() * count)
  const latest = Math.max(vintage, Math.min(vintage + drift, thisYear))
  const start = latest - count + 1
  return Array.from({ length: count }, (_, i) => start + i)
}

export function buildOptions(
  facts: WineFacts,
  activeCategories: readonly CategoryKey[],
  rng: Rng = Math.random,
  thisYear: number = new Date().getFullYear(),
): OptionSet {
  const on = (k: CategoryKey) => activeCategories.includes(k)
  const out: OptionSet = {}

  // Style and world are closed sets — showing all of them is the game. Style is
  // the one category whose correct answer is NOT derived from the fact itself,
  // so an off-canon value (a hand-typed "off-dry", a bulk import) would put four
  // buttons on the board with the right answer among none of them: every bet
  // unwinnable and no answer to highlight at the reveal. Skip instead.
  if (on('style') && facts.style && STYLE_VALUES.has(facts.style.trim().toLowerCase())) {
    out.style = [...STYLE_OPTIONS]
  }
  if (on('world') && worldOf(facts.country)) out.world = [...WORLD_OPTIONS]

  if (on('country') && facts.country) {
    out.country = withDistractors(countryOption(facts.country), COUNTRIES, OPTION_COUNTS.country, rng)
  }

  if (on('grape') && facts.grape) {
    const correct = grapeOption(facts.grape)
    const group = grapeGroup(facts.color)
    const scoped = group ? GRAPES.filter(g => g.group === group) : GRAPES
    const pool = scoped.length >= OPTION_COUNTS.grape ? scoped : GRAPES
    out.grape = withDistractors(correct, pool, OPTION_COUNTS.grape, rng)
  }

  if (on('region') && facts.region) {
    const correct: Option = { value: facts.region.trim().toLowerCase(), ru: facts.region, en: facts.region }
    out.region = withDistractors(correct, regionsFor(facts.country), OPTION_COUNTS.region, rng)
  }

  // A vintage board is `count` consecutive years that must contain the answer
  // and must not reach into the future. For a wine from the current year those
  // constraints leave exactly one legal window, so the answer is always the last
  // button — a guaranteed x10 for anyone who spots it. We cannot pose the
  // question fairly, so we do not pose it.
  if (on('vintage') && facts.vintage && facts.vintage < thisYear) {
    out.vintage = vintageWindow(facts.vintage, OPTION_COUNTS.vintage, rng, thisYear)
      .map(y => ({ value: String(y), ru: String(y), en: String(y) }))
  }

  return out
}
