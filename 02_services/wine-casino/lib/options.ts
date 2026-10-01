import { STYLE_OPTIONS, WORLD_OPTIONS, worldOf } from './categories'
import { GRAPES, grapeGroup, grapeOption, isKnownCountry, isKnownRegion } from './wine-data'
import type { CategoryKey, Option, OptionSet, WineFacts } from './types'

// How many buttons a guest sees per `choice` category. Fixed across
// difficulties — difficulty only moves the hint schedule (see hints.ts).
//
// THE RULE: every count must be >= its category's multiplier. Betting A chips
// on a uniform blind guess returns A*(m - n)/n, so m > n makes ignorance
// profitable. The invariant test in options.test.ts locks this down for every
// category whose `input` is `'choice'`.
//
// `country` and `region` are deliberately absent: they are `open` categories
// (free text against a dictionary, see wine-data.ts/bets.ts) and never get a
// board, so there is no button count to protect. `style` is absent too — it
// is no longer a betting category (see categories.ts) — but buildOptions
// below still knows how to build its board for a game created before this
// change, from the fixed STYLE_OPTIONS list rather than a count.
export const OPTION_COUNTS: Partial<Record<CategoryKey, number>> = {
  world:   2,
  grape:   12,
  vintage: 16,
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

  // Country and region are free entry now (see categories.ts): the guest types
  // a guess and picks from suggestions client-side, so there is never a button
  // board to build. But `options` is also how the rest of the system (the UI,
  // validateBetSlip) learns whether this wine asks the question at all — an
  // absent key must mean "not asked", so an *open* category that IS in play
  // needs its own, different signal. It gets one: an empty array. `[]` reads
  // as "open category, no buttons, but live"; absence reads as "not live".
  //
  // A region board built from one country's own regions used to give the
  // country away for free (every option on it was the same country), and a
  // country board drawn from our decoy pool told the same story from the
  // other side — that is the whole reason these moved off a board. We still
  // only ask the question when it can be asked fairly: an admin-typed country
  // or region outside our dictionaries is exactly the same "we don't know, so
  // we don't ask" case as an off-canon style or an unrecognised world country.
  if (on('country') && facts.country && isKnownCountry(facts.country)) out.country = []
  if (on('region') && facts.region && isKnownRegion(facts.region)) out.region = []

  if (on('grape') && facts.grape) {
    const correct = grapeOption(facts.grape, facts.color)
    // facts.color can be blank (a hand-entered wine that never got a colour
    // recorded). Falling back straight to the whole pool in that case used to
    // hand a Sauvignon Blanc five red decoys and one white option — the answer
    // was obvious without tasting. Try the correct grape's OWN group first
    // (known from our table regardless of the bottle's colour field), and only
    // widen to the full pool when neither the bottle nor our table knows it.
    const group = grapeGroup(facts.color) ?? correct.group
    const scoped = group ? GRAPES.filter(g => g.group === group) : GRAPES
    const pool = scoped.length >= OPTION_COUNTS.grape! ? scoped : GRAPES
    out.grape = withDistractors(correct, pool, OPTION_COUNTS.grape!, rng)
  }

  // A vintage board is `count` consecutive years that must contain the answer
  // and must not reach into the future. For a wine from the current year those
  // constraints leave exactly one legal window, so the answer is always the last
  // button — a guaranteed payout for anyone who spots it. We cannot pose the
  // question fairly, so we do not pose it.
  if (on('vintage') && facts.vintage && facts.vintage < thisYear) {
    out.vintage = vintageWindow(facts.vintage, OPTION_COUNTS.vintage!, rng, thisYear)
      .map(y => ({ value: String(y), ru: String(y), en: String(y) }))
  }

  return out
}
