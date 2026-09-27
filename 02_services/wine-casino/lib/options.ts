import { STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'
import { COUNTRIES, GRAPES, countryOption, grapeGroup, grapeOption, regionsFor } from './wine-data'
import type { CategoryKey, Option, OptionSet, WineFacts } from './types'

// How many buttons a guest sees per category. Fixed across difficulties —
// difficulty only moves the hint schedule (see hints.ts).
export const OPTION_COUNTS: Record<CategoryKey, number> = {
  style:   4,
  world:   2,
  country: 6,
  grape:   6,
  region:  4,
  vintage: 5,
}

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
 *  years is just annoying to read on a phone. */
function vintageWindow(vintage: number, count: number, rng: Rng): number[] {
  const offset = Math.floor(rng() * count)
  const start = vintage - offset
  return Array.from({ length: count }, (_, i) => start + i)
}

export function buildOptions(
  facts: WineFacts,
  activeCategories: readonly CategoryKey[],
  rng: Rng = Math.random,
): OptionSet {
  const on = (k: CategoryKey) => activeCategories.includes(k)
  const out: OptionSet = {}

  // Style and world are closed sets — showing all of them is the game.
  if (on('style') && facts.style) out.style = [...STYLE_OPTIONS]
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

  if (on('vintage') && facts.vintage) {
    out.vintage = vintageWindow(facts.vintage, OPTION_COUNTS.vintage, rng)
      .map(y => ({ value: String(y), ru: String(y), en: String(y) }))
  }

  return out
}
