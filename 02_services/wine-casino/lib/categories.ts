import { COUNTRIES } from './wine-data'
import type { CategoryDef, Option } from './types'

// Multipliers follow the classic game: the vaguer the question, the cheaper it
// pays. Vintage is the hardest and the richest. Every game stores its own copy
// in casino.game.categories so a host can retune without a deploy.
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { key: 'style',   multiplier: 1.5, ru: 'Стиль',               en: 'Style' },
  { key: 'world',   multiplier: 2,   ru: 'Старый / Новый Свет', en: 'Old / New World' },
  { key: 'country', multiplier: 4,   ru: 'Страна',              en: 'Country' },
  { key: 'grape',   multiplier: 6,   ru: 'Сорт',                en: 'Grape' },
  { key: 'region',  multiplier: 8,   ru: 'Регион',              en: 'Region' },
  { key: 'vintage', multiplier: 10,  ru: 'Год',                 en: 'Vintage' },
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
