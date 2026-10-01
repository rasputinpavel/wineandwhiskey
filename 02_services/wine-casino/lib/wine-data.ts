import type { Option, WineColor } from './types'

// Distractor pools. These do not have to be exhaustive — they have to be
// plausible enough that a guest cannot win by elimination. Values are the
// canonical lowercase key; ru/en are what the phone shows.
//
// This is a curated list of wine-PRODUCING countries, not a world atlas: the
// country board draws its decoys from this table, and a non-wine country
// among the options is one a guest discards without tasting.

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

  // Added for the real evenings' pours — every one of these genuinely sells
  // wine somewhere, not just appears on a world map.
  { value: 'romania',               ru: 'Румыния',              en: 'Romania' },
  { value: 'croatia',               ru: 'Хорватия',             en: 'Croatia' },
  { value: 'slovenia',              ru: 'Словения',             en: 'Slovenia' },
  { value: 'switzerland',           ru: 'Швейцария',            en: 'Switzerland' },
  { value: 'serbia',                ru: 'Сербия',               en: 'Serbia' },
  { value: 'czechia',               ru: 'Чехия',                en: 'Czechia' },
  { value: 'slovakia',              ru: 'Словакия',             en: 'Slovakia' },
  { value: 'north macedonia',       ru: 'Северная Македония',   en: 'North Macedonia' },
  { value: 'bosnia and herzegovina',ru: 'Босния и Герцеговина', en: 'Bosnia and Herzegovina' },
  { value: 'montenegro',            ru: 'Черногория',           en: 'Montenegro' },
  { value: 'ukraine',               ru: 'Украина',              en: 'Ukraine' },
  { value: 'armenia',               ru: 'Армения',              en: 'Armenia' },
  { value: 'azerbaijan',            ru: 'Азербайджан',          en: 'Azerbaijan' },
  { value: 'turkey',                ru: 'Турция',               en: 'Turkey' },
  { value: 'morocco',               ru: 'Марокко',              en: 'Morocco' },
  { value: 'tunisia',               ru: 'Тунис',                en: 'Tunisia' },
  { value: 'algeria',               ru: 'Алжир',                en: 'Algeria' },
  { value: 'england',               ru: 'Англия',               en: 'England' },
  { value: 'luxembourg',            ru: 'Люксембург',           en: 'Luxembourg' },
  { value: 'brazil',                ru: 'Бразилия',             en: 'Brazil' },
  { value: 'mexico',                ru: 'Мексика',              en: 'Mexico' },
  { value: 'canada',                ru: 'Канада',               en: 'Canada' },
  { value: 'peru',                  ru: 'Перу',                 en: 'Peru' },
  { value: 'bolivia',               ru: 'Боливия',              en: 'Bolivia' },
  { value: 'china',                 ru: 'Китай',                en: 'China' },
  { value: 'japan',                 ru: 'Япония',               en: 'Japan' },
  { value: 'india',                 ru: 'Индия',                en: 'India' },
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
  { value: 'barbera',            ru: 'Barbera',            en: 'Barbera',            group: 'red' },
  { value: 'corvina',            ru: 'Corvina',            en: 'Corvina',            group: 'red' },
  { value: "nero d'avola",       ru: "Nero d'Avola",       en: "Nero d'Avola",       group: 'red' },
  { value: 'aglianico',          ru: 'Aglianico',          en: 'Aglianico',          group: 'red' },
  { value: 'tannat',             ru: 'Tannat',             en: 'Tannat',             group: 'red' },
  { value: 'petit verdot',       ru: 'Petit Verdot',       en: 'Petit Verdot',       group: 'red' },
  { value: 'petite sirah',       ru: 'Petite Sirah',       en: 'Petite Sirah',       group: 'red' },
  { value: 'mourvedre',          ru: 'Mourvèdre',          en: 'Mourvèdre',          group: 'red' },
  { value: 'cinsault',           ru: 'Cinsault',           en: 'Cinsault',           group: 'red' },
  { value: 'gamay',              ru: 'Gamay',              en: 'Gamay',              group: 'red' },
  { value: 'touriga nacional',   ru: 'Touriga Nacional',   en: 'Touriga Nacional',   group: 'red' },
  { value: 'zweigelt',           ru: 'Zweigelt',           en: 'Zweigelt',           group: 'red' },
  { value: 'blaufrankisch',      ru: 'Blaufränkisch',      en: 'Blaufränkisch',      group: 'red' },
  { value: 'xinomavro',          ru: 'Xinomavro',          en: 'Xinomavro',          group: 'red' },
  { value: 'agiorgitiko',        ru: 'Agiorgitiko',        en: 'Agiorgitiko',        group: 'red' },
  { value: 'mencia',             ru: 'Mencía',             en: 'Mencía',             group: 'red' },
  { value: 'pinotage',           ru: 'Pinotage',           en: 'Pinotage',           group: 'red' },
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
  { value: 'semillon',           ru: 'Sémillon',           en: 'Sémillon',           group: 'white' },
  { value: 'marsanne',           ru: 'Marsanne',           en: 'Marsanne',           group: 'white' },
  { value: 'roussanne',          ru: 'Roussanne',          en: 'Roussanne',          group: 'white' },
  { value: 'gruner veltliner',   ru: 'Grüner Veltliner',   en: 'Grüner Veltliner',   group: 'white' },
  { value: 'furmint',            ru: 'Furmint',            en: 'Furmint',            group: 'white' },
  { value: 'assyrtiko',          ru: 'Assyrtiko',          en: 'Assyrtiko',          group: 'white' },
  { value: 'vermentino',         ru: 'Vermentino',         en: 'Vermentino',         group: 'white' },
  { value: 'garganega',          ru: 'Garganega',          en: 'Garganega',          group: 'white' },
  { value: 'trebbiano',          ru: 'Trebbiano',          en: 'Trebbiano',          group: 'white' },
  { value: 'torrontes',          ru: 'Torrontés',          en: 'Torrontés',          group: 'white' },
  { value: 'muller-thurgau',     ru: 'Müller-Thurgau',     en: 'Müller-Thurgau',     group: 'white' },
  { value: 'godello',            ru: 'Godello',            en: 'Godello',            group: 'white' },
  { value: 'fiano',              ru: 'Fiano',              en: 'Fiano',              group: 'white' },
  { value: 'falanghina',         ru: 'Falanghina',         en: 'Falanghina',         group: 'white' },
  { value: 'malvasia',           ru: 'Malvasia',           en: 'Malvasia',           group: 'white' },
  { value: 'verdicchio',         ru: 'Verdicchio',         en: 'Verdicchio',         group: 'white' },
  { value: 'moschofilero',       ru: 'Moschofilero',       en: 'Moschofilero',       group: 'white' },
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

  romania:       ['Dealu Mare', 'Cotnari', 'Murfatlar', 'Târnave', 'Recaș', 'Odobești', 'Drăgășani', 'Dealurile Moldovei'],
  croatia:       ['Istria', 'Dalmatia', 'Slavonia', 'Plešivica', 'Pelješac', 'Hvar', 'Korčula', 'Konavle'],
  slovenia:      ['Podravje', 'Posavje', 'Primorska', 'Vipava Valley', 'Goriška Brda', 'Štajerska', 'Dolenjska', 'Bela Krajina'],
  switzerland:   ['Valais', 'Vaud', 'Geneva', 'Ticino', 'Neuchâtel', 'Graubünden', 'Zürich', 'Schaffhausen'],
  serbia:        ['Šumadija', 'Negotin', 'Vršac', 'Fruška Gora', 'Župa', 'Timok', 'Pocerina', 'Nišava'],
  czechia:       ['Moravia', 'Bohemia', 'Znojmo', 'Mikulov', 'Velké Pavlovice', 'Slovácko', 'Mělník', 'Litoměřice'],
  slovakia:      ['Malokarpatská', 'Južnoslovenská', 'Nitrianska', 'Stredoslovenská', 'Východoslovenská', 'Tokaj', 'Skalický', 'Modranský'],
  'north macedonia': ['Tikveš', 'Kavadarci', 'Negotino', 'Demir Kapija', 'Veles', 'Gevgelija', 'Valandovo', 'Štip'],
  'bosnia and herzegovina': ['Mostar', 'Čapljina', 'Stolac', 'Trebinje', 'Ljubuški', 'Čitluk', 'Nevesinje', 'Gacko'],
  montenegro:    ['Crmnica', 'Podgorica', 'Lake Skadar', 'Ćemovsko Polje', 'Bar', 'Ulcinj', 'Cetinje', 'Nikšić'],
  ukraine:       ['Odesa', 'Crimea', 'Zakarpattia', 'Kherson', 'Mykolaiv', 'Bessarabia', 'Shabo', 'Koktebel'],
  armenia:       ['Vayots Dzor', 'Ararat Valley', 'Armavir', 'Aragatsotn', 'Tavush', 'Syunik', 'Areni', 'Yeghegnadzor'],
  azerbaijan:    ['Ganja-Qazakh', 'Shamkir', 'Tovuz', 'Ismayilli', 'Shaki', 'Gabala', 'Goygol', 'Geychay'],
  turkey:        ['Thrace', 'Aegean', 'Cappadocia', 'Denizli', 'Elazığ', 'Diyarbakır', 'Nevşehir', 'Marmara'],
  morocco:       ['Meknès', 'Guerrouane', 'Zaër', 'Zemmour', 'Saïs', 'Gharb', 'Chaouia', 'Berkane'],
  tunisia:       ['Mornag', 'Kelibia', 'Thibar', 'Côteaux de Tébourba', "Côteaux d'Utique", 'Sidi Salem', 'Bizerte', 'Cap Bon'],
  algeria:       ['Coteaux de Mascara', 'Monts du Tessala', 'Mascara', 'Médéa', 'Aïn Bessem', 'Zaccar', 'Dahra', 'Coteaux de Tlemcen'],
  england:       ['Kent', 'Sussex', 'Hampshire', 'Surrey', 'Essex', 'Cornwall', 'Dorset', 'Yorkshire'],
  luxembourg:    ['Remich', 'Grevenmacher', 'Wormeldange', 'Schengen', 'Wellenstein', 'Stadtbredimus', 'Ehnen', 'Ahn'],
  brazil:        ['Serra Gaúcha', 'Vale dos Vinhedos', 'Campanha', 'Serra do Sudeste', 'Vale do São Francisco', 'Planalto Catarinense', 'Campos de Cima da Serra', 'Pinto Bandeira'],
  mexico:        ['Valle de Guadalupe', 'Valle de Parras', 'Querétaro', 'Aguascalientes', 'Coahuila', 'Zacatecas', 'San Luis Potosí', 'Baja California'],
  canada:        ['Okanagan Valley', 'Niagara Peninsula', 'Prince Edward County', 'Similkameen Valley', 'Fraser Valley', 'Annapolis Valley', 'Lake Erie North Shore', 'Vancouver Island'],
  peru:          ['Ica', 'Tacna', 'Lima', 'Arequipa', 'Moquegua', 'Cañete', 'Chincha', 'Nazca'],
  bolivia:       ['Valle de la Concepción', 'Camargo', 'Cinti', 'San Lucas', 'San Jacinto', 'El Valle', 'Uriondo', 'Padcaya'],
  china:         ['Ningxia', 'Shandong', 'Hebei', 'Xinjiang', 'Shanxi', 'Yunnan', 'Jilin', 'Gansu'],
  japan:         ['Yamanashi', 'Nagano', 'Yamagata', 'Hokkaido', 'Osaka', 'Niigata', 'Tochigi', 'Iwate'],
  india:         ['Nashik', 'Nandi Hills', 'Sangli', 'Solapur', 'Hampi Hills', 'Baramati', 'Pune', 'Dindori'],
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
