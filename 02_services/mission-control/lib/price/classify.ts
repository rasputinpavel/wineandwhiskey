type Category = 'wine' | 'spirits' | 'beer' | 'other'
type WineType = 'red' | 'white' | 'rose' | 'orange' | 'sparkling' | null

// Order matters: more specific subtypes (whisky variants) first.
const SPIRIT_SUBTYPES: { type: string; rx: RegExp }[] = [
  { type: 'whisky',     rx: /\b(whisky|whiskey|bourbon|scotch|single\s+malt|blended\s+malt|rye\s+whisky|irish\s+whiskey|tennessee\s+whiskey)\b/i },
  { type: 'cognac',     rx: /\b(cognac|hennessy|martell|r[eé]my\s+martin|courvoisier)\b/i },
  { type: 'armagnac',   rx: /\barmagnac\b/i },
  { type: 'calvados',   rx: /\bcalvados\b/i },
  { type: 'brandy',     rx: /\bbrandy\b/i },
  { type: 'grappa',     rx: /\b(grappa|marc)\b/i },
  { type: 'gin',        rx: /\bgin\b/i },
  { type: 'vodka',      rx: /\bvodka\b/i },
  { type: 'rum',        rx: /\b(rum|cachaça|cachaca)\b/i },
  { type: 'tequila',    rx: /\b(tequila|mezcal)\b/i },
  { type: 'shochu',     rx: /\bshochu\b/i },
  { type: 'sake',       rx: /\b(sake|junmai|daiginjo|nigori)\b/i },
  { type: 'vermouth',   rx: /\bvermouth\b/i },
  { type: 'bitters',    rx: /\b(bitters|amaro|fernet)\b/i },
  { type: 'aperitif',   rx: /\b(aperitif|aperol|campari|lillet|pastis|ouzo|absinthe)\b/i },
  { type: 'liqueur',    rx: /\b(liqueur|limoncello|baileys|kahlua|sambuca|chartreuse|cointreau|grand\s+marnier|drambuie|frangelico|amaretto|triple\s+sec|cr[eè]me\s+de)\b/i },
  { type: 'eau-de-vie', rx: /\b(eau\s+de\s+vie|kirsch|williams\s+pear)\b/i },
]

const SPIRITS_RX = /\b(whisky|whiskey|bourbon|scotch|vodka|gin|rum|tequila|mezcal|cognac|brandy|calvados|armagnac|grappa|marc|sake|soju|baijiu|schnapps|liqueur|aperitif|amaro|vermouth|bitters|absinthe|chartreuse|campari|limoncello|baileys|kahlua|sambuca|ouzo|pastis|pisco|cachaça|cachaca|shochu|junmai|daiginjo|fernet|aperol|lillet|cointreau)\b/i

const BEER_RX = /\b(beer|ale|lager|stout|porter|ipa|pilsner|weiss|weizen|hefeweizen|witbier|saison|sour|pale ale|dark ale|craft beer|bier|cerveza|bière)\b/i

const ROSE_RX = /\b(ros[eé]|rosado|rosato|blush)\b/i

const ORANGE_RX = /\b(orange\s+wine|skin[\s-]?contact|qvevri|kvevri|amphora|ramato)\b/i

const SPARKLING_RX = /\b(champagne|prosecco|cava|cremant|crémant|sekt|spumante|frizzante|mousseux|sparkling|pét.?nat|petillant|franciacorta|asti)\b/i

const WHITE_RX = /\b(blanc|white|bianco|blanco|weiss|weisswein|chardonnay|sauvignon blanc|riesling|pinot gr(is|igio)|gewurztraminer|gewürztraminer|viognier|chenin|muscat|albarino|albariño|verdejo|torront[eé]s|greco|fiano|vermentino|arneis|gavi|soave|chablis|burgundy blanc|white burgundy|sémillon|semillon)\b/i

const RED_RX = /\b(rouge|red|rosso|tinto|rot\b|shiraz|syrah|cabernet|merlot|pinot noir|malbec|tempranillo|grenache|garnacha|rioja|barolo|barbaresco|amarone|brunello|chianti|montepulciano|sangiovese|nero d'avola|primitivo|zinfandel|carmenere|carménère|touriga|douro|port|porto)\b/i

export function classifyItem(name: string, description?: string | null): {
  category: Category
  wine_type: WineType
  spirit_type: string | null
} {
  const text = `${name} ${description ?? ''}`.toLowerCase()

  if (SPIRITS_RX.test(text)) {
    const subtype = SPIRIT_SUBTYPES.find(s => s.rx.test(text))?.type ?? 'other'
    return { category: 'spirits', wine_type: null, spirit_type: subtype }
  }
  if (BEER_RX.test(text)) return { category: 'beer', wine_type: null, spirit_type: null }

  // Default to wine. Order: orange/rose/sparkling are specific, then white/red.
  let wine_type: WineType = null
  if (ORANGE_RX.test(text)) wine_type = 'orange'
  else if (ROSE_RX.test(text)) wine_type = 'rose'
  else if (SPARKLING_RX.test(text)) wine_type = 'sparkling'
  else if (WHITE_RX.test(text)) wine_type = 'white'
  else if (RED_RX.test(text)) wine_type = 'red'

  return { category: 'wine', wine_type, spirit_type: null }
}

// Normalize a free-text spirit category header (e.g. "WHISKY", "Brandy", "Rice Spirit")
// into a canonical spirit_type. Used by parsers when section headers are reliable.
export function normalizeSpiritType(header: string): string | null {
  const h = header.toLowerCase().trim()
  if (!h) return null
  if (/\b(whisky|whiskey|bourbon|scotch)\b/.test(h)) return 'whisky'
  if (/\bcognac\b/.test(h)) return 'cognac'
  if (/\barmagnac\b/.test(h)) return 'armagnac'
  if (/\bcalvados\b/.test(h)) return 'calvados'
  if (/\bbrandy\b/.test(h)) return 'brandy'
  if (/\bgrappa\b/.test(h)) return 'grappa'
  if (/\bgin\b/.test(h)) return 'gin'
  if (/\bvodka\b/.test(h)) return 'vodka'
  if (/\b(rum|cachaça|cachaca)\b/.test(h)) return 'rum'
  if (/\b(tequila|mezcal)\b/.test(h)) return 'tequila'
  if (/\bshochu\b/.test(h)) return 'shochu'
  if (/\bsake\b/.test(h)) return 'sake'
  if (/\bvermouth\b/.test(h)) return 'vermouth'
  if (/\bbitters\b/.test(h)) return 'bitters'
  if (/\bamaro\b/.test(h)) return 'amaro'
  if (/\bdigestif\b/.test(h)) return 'digestif'
  if (/\baperitif\b/.test(h)) return 'aperitif'
  if (/\bliqueur\b/.test(h)) return 'liqueur'
  if (/rice\s+spirit/.test(h)) return 'other'
  if (/eau\s+de\s+vie/.test(h)) return 'eau-de-vie'
  return null
}
