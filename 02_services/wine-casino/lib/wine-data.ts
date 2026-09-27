import type { Option, WineColor } from './types'

// Distractor pools. These do not have to be exhaustive — they have to be
// plausible enough that a guest cannot win by elimination. Values are the
// canonical lowercase key; ru/en are what the phone shows.

export const COUNTRIES: Option[] = [
  { value: 'france',       ru: 'Франция',      en: 'France' },
  { value: 'italy',        ru: 'Италия',       en: 'Italy' },
  { value: 'spain',        ru: 'Испания',      en: 'Spain' },
  { value: 'portugal',     ru: 'Португалия',   en: 'Portugal' },
  { value: 'germany',      ru: 'Германия',     en: 'Germany' },
  { value: 'austria',      ru: 'Австрия',      en: 'Austria' },
  { value: 'greece',       ru: 'Греция',       en: 'Greece' },
  { value: 'hungary',      ru: 'Венгрия',      en: 'Hungary' },
  { value: 'georgia',      ru: 'Грузия',       en: 'Georgia' },
  { value: 'moldova',      ru: 'Молдавия',     en: 'Moldova' },
  { value: 'russia',       ru: 'Россия',       en: 'Russia' },
  { value: 'chile',        ru: 'Чили',         en: 'Chile' },
  { value: 'argentina',    ru: 'Аргентина',    en: 'Argentina' },
  { value: 'australia',    ru: 'Австралия',    en: 'Australia' },
  { value: 'new zealand',  ru: 'Новая Зеландия', en: 'New Zealand' },
  { value: 'south africa', ru: 'ЮАР',          en: 'South Africa' },
  { value: 'usa',          ru: 'США',          en: 'USA' },
  { value: 'uruguay',      ru: 'Уругвай',      en: 'Uruguay' },
  { value: 'lebanon',      ru: 'Ливан',        en: 'Lebanon' },
  { value: 'israel',       ru: 'Израиль',      en: 'Israel' },
  { value: 'bulgaria',     ru: 'Болгария',     en: 'Bulgaria' },
  { value: 'cyprus',       ru: 'Кипр',         en: 'Cyprus' },
  // We are in Phuket and Monsoon Valley is on our own shelf.
  { value: 'thailand',     ru: 'Таиланд',      en: 'Thailand' },
]

/** Grapes carry a colour group so a red wine never gets Chardonnay as a decoy.
 *  `null` means we genuinely do not know — see grapeOption. */
export type GrapeOption = Option & { group: 'red' | 'white' | null }

export const GRAPES: GrapeOption[] = [
  { value: 'cabernet sauvignon', ru: 'Cabernet Sauvignon', en: 'Cabernet Sauvignon', group: 'red' },
  { value: 'merlot',             ru: 'Merlot',             en: 'Merlot',             group: 'red' },
  { value: 'syrah',              ru: 'Syrah / Shiraz',     en: 'Syrah / Shiraz',     group: 'red' },
  { value: 'pinot noir',         ru: 'Pinot Noir',         en: 'Pinot Noir',         group: 'red' },
  { value: 'sangiovese',         ru: 'Sangiovese',         en: 'Sangiovese',         group: 'red' },
  { value: 'nebbiolo',           ru: 'Nebbiolo',           en: 'Nebbiolo',           group: 'red' },
  { value: 'tempranillo',        ru: 'Tempranillo',        en: 'Tempranillo',        group: 'red' },
  { value: 'malbec',             ru: 'Malbec',             en: 'Malbec',             group: 'red' },
  { value: 'carmenere',          ru: 'Carménère',          en: 'Carménère',          group: 'red' },
  { value: 'saperavi',           ru: 'Saperavi',           en: 'Saperavi',           group: 'red' },
  { value: 'grenache',           ru: 'Grenache',           en: 'Grenache',           group: 'red' },
  { value: 'primitivo',          ru: 'Primitivo',          en: 'Primitivo',          group: 'red' },
  { value: 'montepulciano',      ru: 'Montepulciano',      en: 'Montepulciano',      group: 'red' },
  { value: 'chardonnay',         ru: 'Chardonnay',         en: 'Chardonnay',         group: 'white' },
  { value: 'sauvignon blanc',    ru: 'Sauvignon Blanc',    en: 'Sauvignon Blanc',    group: 'white' },
  { value: 'riesling',           ru: 'Riesling',           en: 'Riesling',           group: 'white' },
  { value: 'pinot grigio',       ru: 'Pinot Grigio',       en: 'Pinot Grigio',       group: 'white' },
  { value: 'rkatsiteli',         ru: 'Rkatsiteli',         en: 'Rkatsiteli',         group: 'white' },
  { value: 'viognier',           ru: 'Viognier',           en: 'Viognier',           group: 'white' },
  { value: 'chenin blanc',       ru: 'Chenin Blanc',       en: 'Chenin Blanc',       group: 'white' },
  { value: 'gewurztraminer',     ru: 'Gewürztraminer',     en: 'Gewürztraminer',     group: 'white' },
  { value: 'albarino',           ru: 'Albariño',           en: 'Albariño',           group: 'white' },
  { value: 'verdejo',            ru: 'Verdejo',            en: 'Verdejo',            group: 'white' },
  { value: 'muscat',             ru: 'Muscat',             en: 'Muscat',             group: 'white' },
  { value: 'glera',              ru: 'Glera',              en: 'Glera',              group: 'white' },
]

const REGIONS: Record<string, string[]> = {
  france:        ['Bordeaux', 'Bourgogne', 'Rhône', 'Loire', 'Languedoc', 'Provence', 'Champagne', 'Alsace'],
  italy:         ['Toscana', 'Piemonte', 'Veneto', 'Puglia', 'Sicilia', 'Abruzzo', 'Umbria', 'Friuli'],
  spain:         ['Rioja', 'Ribera del Duero', 'Priorat', 'Rueda', 'Rías Baixas', 'La Mancha', 'Navarra', 'Jerez'],
  portugal:      ['Douro', 'Alentejo', 'Vinho Verde', 'Dão', 'Bairrada', 'Setúbal', 'Lisboa', 'Madeira'],
  germany:       ['Mosel', 'Rheingau', 'Pfalz', 'Baden', 'Rheinhessen', 'Nahe', 'Franken', 'Württemberg'],
  austria:       ['Wachau', 'Burgenland', 'Kamptal', 'Kremstal', 'Weinviertel', 'Thermenregion', 'Traisental', 'Carnuntum'],
  greece:        ['Santorini', 'Nemea', 'Naoussa', 'Mantinia', 'Rapsani', 'Amyndeon', 'Peloponnese', 'Crete'],
  hungary:       ['Tokaj', 'Eger', 'Villány', 'Szekszárd', 'Badacsony', 'Somló', 'Mátra', 'Balaton'],
  georgia:       ['Kakheti', 'Kartli', 'Imereti', 'Racha', 'Guria', 'Samegrelo', 'Adjara', 'Lechkhumi'],
  moldova:       ['Codru', 'Valul lui Traian', 'Ștefan Vodă', 'Purcari', 'Cricova', 'Nistreana', 'Bălți', 'Orhei'],
  russia:        ['Кубань', 'Крым', 'Долина Дона', 'Севастополь', 'Тамань', 'Анапа', 'Ставрополье', 'Дагестан'],
  chile:         ['Maipo', 'Colchagua', 'Casablanca', 'Maule', 'Aconcagua', 'Curicó', 'Limarí', 'Leyda'],
  argentina:     ['Mendoza', 'Salta', 'Patagonia', 'San Juan', 'Uco Valley', 'La Rioja', 'Catamarca', 'Neuquén'],
  australia:     ['Barossa', 'McLaren Vale', 'Yarra Valley', 'Coonawarra', 'Clare Valley', 'Hunter Valley', 'Margaret River', 'Adelaide Hills'],
  'new zealand': ['Marlborough', 'Central Otago', 'Hawke\'s Bay', 'Martinborough', 'Nelson', 'Gisborne', 'Waipara', 'Wairarapa'],
  'south africa':['Stellenbosch', 'Swartland', 'Paarl', 'Walker Bay', 'Franschhoek', 'Constantia', 'Robertson', 'Elgin'],
  usa:           ['Napa Valley', 'Sonoma', 'Willamette Valley', 'Paso Robles', 'Santa Barbara', 'Columbia Valley', 'Finger Lakes', 'Russian River Valley'],
  uruguay:       ['Canelones', 'Maldonado', 'Montevideo', 'Colonia', 'San José', 'Florida', 'Rivera', 'Durazno'],
  lebanon:       ['Bekaa Valley', 'Batroun', 'Jezzine', 'Zahlé', 'Kefraya', 'Mount Lebanon', 'Chouf', 'Rashaya'],
  israel:        ['Galilee', 'Judean Hills', 'Golan Heights', 'Shomron', 'Samson', 'Negev', 'Upper Galilee', 'Carmel'],
  bulgaria:      ['Thracian Valley', 'Danubian Plain', 'Struma Valley', 'Rose Valley', 'Black Sea Coast', 'Sakar', 'Melnik', 'Pomorie'],
  cyprus:        ['Limassol', 'Paphos', 'Commandaria', 'Troodos', 'Pitsilia', 'Krasochoria', 'Vouni Panagias', 'Laona'],
  thailand:      ['Hua Hin', 'Khao Yai', 'Chiang Mai', 'Loei', 'Chonburi', 'Nakhon Ratchasima', 'Samut Sakhon', 'Ratchaburi'],
}

/** A pool of plausible regions, drawn from the wine's own country. Every
 *  country above carries at least OPTION_COUNTS.region entries precisely so the
 *  board never has to borrow: a foreign decoy is obvious next to a Bekaa Valley,
 *  and a guest who eliminates the obvious ones is back to a x8 payout on a
 *  handful of real candidates. The cross-country fallback remains only for a
 *  country we have not catalogued at all. */
export function regionsFor(country: string | null): Option[] {
  const key = (country ?? '').trim().toLowerCase()
  const own = REGIONS[key] ?? []
  const rest = Object.entries(REGIONS)
    .filter(([k]) => k !== key)
    .flatMap(([, v]) => v)
  // Keep OPTION_COUNTS.region (options.ts) in step with this number: below it
  // the board cannot be filled from one country and has to borrow decoys.
  const names = own.length >= 8 ? own : [...own, ...rest]
  return names.map(n => ({ value: n.toLowerCase(), ru: n, en: n }))
}

export function countryOption(country: string): Option {
  const key = country.trim().toLowerCase()
  return COUNTRIES.find(c => c.value === key) ?? { value: key, ru: country, en: country }
}

/** For a grape outside our pool, take the colour from the bottle rather than
 *  guessing. Hints state the grape's colour as fact and guests bet chips on it,
 *  so a wrong guess is worse than no answer: Kisi is a Georgian amber grape we
 *  actually stock, and a hardcoded 'red' fallback would have announced it red. */
export function grapeOption(grape: string, color?: WineColor | null): GrapeOption {
  const key = grape.trim().toLowerCase()
  return GRAPES.find(g => g.value === key)
      ?? { value: key, ru: grape, en: grape, group: grapeGroup(color ?? null) }
}

/** Rosé is pressed from red grapes; orange from white. Sparkling is mostly
 *  white grapes on our shelf. Anything unknown falls back to the whole pool. */
export function grapeGroup(color: WineColor | null): 'red' | 'white' | null {
  if (color === 'red' || color === 'rose') return 'red'
  if (color === 'white' || color === 'orange' || color === 'sparkling') return 'white'
  return null
}
