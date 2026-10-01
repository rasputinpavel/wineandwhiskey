import { COUNTRIES } from './wine-data'
import type { CategoryDef, Option } from './types'

// Multipliers follow the difficulty ladder the owner set after running the
// game live: World is a coin flip, vintage is the hardest and the richest.
// Every game stores its own copy in casino.game.categories so a host can
// retune without a deploy, and a game created before this ladder keeps
// whatever it already has (see README).
//
// Country and region are `open`: free text matched against a dictionary
// (lib/wine-data.ts), not a button board. A region board built from one
// country's own regions gives that country away for free — real options seen
// in a live game were six countries' worth of decoys next to eight regions
// that were all Moldovan — so region (and, for the same reason, country) no
// longer gets a board at all. See lib/options.ts and lib/bets.ts.
//
// Style is no longer a betting category — the owner wants it off the board
// entirely. It stays a fact on the wine (WineFacts.style, STYLE_OPTIONS below)
// shown at the reveal, and 'style' survives as a CategoryKey so a game created
// before this change keeps settling its stored style bets correctly.
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { key: 'world',   multiplier: 2,  input: 'choice', ru: 'Старый / Новый Свет', en: 'Old / New World' },
  { key: 'grape',   multiplier: 6,  input: 'choice', ru: 'Сорт',                en: 'Grape' },
  { key: 'country', multiplier: 10, input: 'open',   ru: 'Страна',              en: 'Country' },
  { key: 'region',  multiplier: 14, input: 'open',   ru: 'Регион',              en: 'Region' },
  { key: 'vintage', multiplier: 16, input: 'choice', ru: 'Год',                 en: 'Vintage' },
]

export const STYLE_OPTIONS: Option[] = [
  { value: 'dry',        ru: 'Сухое',       en: 'Dry' },
  { value: 'semi-dry',   ru: 'Полусухое',   en: 'Semi-dry' },
  { value: 'semi-sweet', ru: 'Полусладкое', en: 'Semi-sweet' },
  { value: 'sweet',      ru: 'Сладкое',     en: 'Sweet' },
]

export const WORLD_OPTIONS: Option[] = [
  { value: 'old', ru: 'Старый Свет', en: 'Old World' },
  { value: 'new', ru: 'Новый Свет',  en: 'New World' },
]

// Europe, the Caucasus, the Levant and North Africa's old wine lands.
// Everything else (the Americas, Australasia, South Africa, Asia) is New World.
const OLD_WORLD = new Set([
  'france', 'italy', 'spain', 'portugal', 'germany', 'austria', 'greece',
  'hungary', 'georgia', 'moldova', 'romania', 'bulgaria', 'croatia', 'slovenia',
  'switzerland', 'serbia', 'czechia', 'north macedonia', 'armenia',
  'israel', 'lebanon', 'turkey', 'russia', 'cyprus',
  'slovakia', 'ukraine', 'bosnia and herzegovina', 'montenegro', 'azerbaijan',
  'morocco', 'tunisia', 'algeria', 'england', 'luxembourg',
])

/**
 * `null` means "we do not recognise this country", and the caller skips the
 * category. Treating an unrecognised string as confidently New World would pay
 * out on a guess: Cyprus was missing from the set above until a review caught
 * it, and the world category pays x2 either way.
 */
export function worldOf(country: string | null): 'old' | 'new' | null {
  const key = country?.trim().toLowerCase()
  if (!key) return null
  if (OLD_WORLD.has(key)) return 'old'
  return COUNTRIES.some(c => c.value === key) ? 'new' : null
}
