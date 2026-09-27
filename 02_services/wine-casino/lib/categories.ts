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

// Europe plus the Caucasus and the Levant cradle. Everything else is New World.
const OLD_WORLD = new Set([
  'france', 'italy', 'spain', 'portugal', 'germany', 'austria', 'greece',
  'hungary', 'georgia', 'moldova', 'romania', 'bulgaria', 'croatia', 'slovenia',
  'switzerland', 'serbia', 'czechia', 'north macedonia', 'armenia',
  'israel', 'lebanon', 'turkey', 'russia',
])

export function worldOf(country: string | null): 'old' | 'new' | null {
  if (!country || !country.trim()) return null
  return OLD_WORLD.has(country.trim().toLowerCase()) ? 'old' : 'new'
}
