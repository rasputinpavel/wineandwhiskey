// Country name → flag emoji for the price-list card meta row. Accepts English
// and common Russian names (the catalog's wine_country is mostly English, but
// manual/CSV rows may be Russian). Falls back to the globe when unknown.

// Name (lower-cased) → ISO-3166 alpha-2.
const NAME_TO_ISO: Record<string, string> = {
  italy: 'IT', италия: 'IT',
  france: 'FR', франция: 'FR',
  spain: 'ES', испания: 'ES',
  portugal: 'PT', португалия: 'PT',
  germany: 'DE', германия: 'DE',
  austria: 'AT', австрия: 'AT',
  moldova: 'MD', молдова: 'MD', молдавия: 'MD',
  georgia: 'GE', грузия: 'GE',
  russia: 'RU', россия: 'RU',
  ukraine: 'UA', украина: 'UA',
  usa: 'US', 'united states': 'US', сша: 'US', америка: 'US',
  argentina: 'AR', аргентина: 'AR',
  chile: 'CL', чили: 'CL',
  australia: 'AU', австралия: 'AU',
  'new zealand': 'NZ', 'новая зеландия': 'NZ',
  'south africa': 'ZA', 'юар': 'ZA',
  greece: 'GR', греция: 'GR',
  hungary: 'HU', венгрия: 'HU',
  japan: 'JP', япония: 'JP',
  ireland: 'IE', ирландия: 'IE',
  england: 'GB', англия: 'GB',
  'united kingdom': 'GB', uk: 'GB', 'великобритания': 'GB',
  armenia: 'AM', армения: 'AM',
  mexico: 'MX', мексика: 'MX',
  lebanon: 'LB', ливан: 'LB',
  croatia: 'HR', хорватия: 'HR',
  slovenia: 'SI', словения: 'SI',
  switzerland: 'CH', швейцария: 'CH',
}

// Subdivision flags that aren't a single ISO country (modern emoji renderers,
// incl. headless Chrome, support these tag sequences).
const SPECIAL: Record<string, string> = {
  scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', шотландия: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', уэльс: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
}

// Display list for the Country autocomplete (wine + spirits origins). Order is
// roughly by how often they appear in the store; the datalist filters as you type.
export const COUNTRIES: string[] = [
  'Italy', 'France', 'Spain', 'Portugal', 'Germany', 'Austria', 'Russia', 'Moldova',
  'Georgia', 'Ukraine', 'Greece', 'Hungary', 'Croatia', 'Slovenia', 'Switzerland',
  'Armenia', 'Lebanon', 'USA', 'Argentina', 'Chile', 'Australia', 'New Zealand',
  'South Africa', 'Mexico', 'Japan', 'Scotland', 'Ireland', 'England', 'United Kingdom',
]

function isoToFlag(iso: string): string {
  return iso.toUpperCase().replace(/[A-Z]/g, c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
}

export function countryToFlag(name: string | null | undefined): string {
  const k = String(name ?? '').trim().toLowerCase()
  if (!k) return '🌍'
  if (SPECIAL[k]) return SPECIAL[k]
  const iso = NAME_TO_ISO[k]
  return iso ? isoToFlag(iso) : '🌍'
}
