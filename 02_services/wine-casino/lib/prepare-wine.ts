import 'server-only'
import { buildOptions } from './options'
import { buildHints } from './hints'
import { worldOf } from './categories'
import { canon } from './text'
import { isKnownCountry, isKnownRegion } from './wine-data'
import type { CategoryDef, Difficulty, Hint, OptionSet, WineAnswers, WineFacts } from './types'

export type PreparedWine = { answers: WineAnswers; options: OptionSet; hints: Hint[] }

/**
 * Derives the answer key, the betting board and the hint schedule from a
 * bottle's facts. Categories with no fact on file are simply absent from
 * `answers` and `options` — settleRound voids any bet that lands on them.
 */
export function prepareWine(
  facts: WineFacts,
  categories: readonly CategoryDef[],
  difficulty: Difficulty,
  roundSeconds: number,
  keepHints?: Hint[] | null,
): PreparedWine {
  const keys = categories.map(c => c.key)

  // canon() is the same normalization settleRound and validateBetSlip apply to
  // both sides of every comparison (see lib/text.ts) — the answer key is built
  // through it too, so there is one rule, not two that happen to agree today.
  const answers: WineAnswers = {}
  if (keys.includes('style') && facts.style)     answers.style = canon(facts.style)
  const world = worldOf(facts.country)
  if (keys.includes('world') && world)           answers.world = world
  // Country and region are only answerable questions when the fact is one our
  // own dictionaries recognise (lib/wine-data.ts) — the same "we don't ask
  // what we can't ask fairly" rule worldOf already applies above. An
  // unrecognised value here would set an answer nobody could ever bet on
  // (lib/bets.ts rejects it outright), which is worse than not asking: a
  // visibly live category nobody can win. buildOptions (options.ts) makes the
  // matching decision from the same two predicates, so `answers` and
  // `options` never disagree about whether the question is being asked.
  if (keys.includes('country') && facts.country && isKnownCountry(facts.country)) answers.country = canon(facts.country)
  if (keys.includes('region') && facts.region && isKnownRegion(facts.region))     answers.region = canon(facts.region)
  if (keys.includes('grape') && facts.grape)     answers.grape = canon(facts.grape)
  if (keys.includes('vintage') && facts.vintage) answers.vintage = canon(String(facts.vintage))

  return {
    answers,
    options: buildOptions(facts, keys),
    // Hand-edited hints survive a re-save; otherwise regenerate from templates.
    hints: keepHints && keepHints.length > 0
      ? keepHints
      : buildHints(facts, difficulty, roundSeconds, keys),
  }
}
