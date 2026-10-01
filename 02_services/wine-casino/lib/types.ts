// Shared vocabulary for the whole service. Imports nothing — everything else
// imports from here, so there is exactly one definition of each shape.

export type Difficulty  = 'easy' | 'medium' | 'hard' | 'pro'
export type GameStatus  = 'draft' | 'lobby' | 'running' | 'finished'
export type RoundStatus = 'pending' | 'betting' | 'locked' | 'revealed'
export type Lang        = 'ru' | 'en'
export type WineColor   = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export type CategoryKey = 'style' | 'world' | 'country' | 'region' | 'grape' | 'vintage'

/** `choice` = a fixed button board (see OPTION_COUNTS / buildOptions).
 *  `open` = free text from the guest, matched against a dictionary instead of
 *  a board (see lib/wine-data.ts and lib/bets.ts) — country and region, which
 *  would otherwise need a board built from decoys that give the answer away. */
export type CategoryInput = 'choice' | 'open'

export type CategoryDef = {
  key: CategoryKey
  multiplier: number
  input: CategoryInput
  ru: string
  en: string
}

/** One selectable answer. `value` is the canonical, language-independent key. */
export type Option = { value: string; ru: string; en: string }

export type OptionSet = Partial<Record<CategoryKey, Option[]>>

/** `at` = seconds REMAINING in the round when this hint appears. */
export type Hint = { at: number; ru: string; en: string }

export type WineAnswers = Partial<Record<CategoryKey, string>>

/** Everything the generators need to know about a bottle. */
export type WineFacts = {
  name:    string
  country: string | null
  region:  string | null
  grape:   string | null
  vintage: number | null
  style:   string | null   // one of STYLE_OPTIONS values
  color:   WineColor | null
  abv:     number | null
}
