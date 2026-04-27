type Category = 'wine' | 'spirits' | 'beer' | 'other'
type WineType = 'red' | 'white' | 'rose' | 'sparkling' | null

const SPIRITS_RX = /\b(whisky|whiskey|bourbon|scotch|vodka|gin|rum|tequila|mezcal|cognac|brandy|calvados|armagnac|grappa|marc|sake|soju|baijiu|schnapps|liqueur|aperitif|amaro|vermouth|bitters|absinthe|chartreuse|campari|limoncello|baileys|kahlua|sambuca|ouzo|pastis|pisco|cachaça|cachaça)\b/i

const BEER_RX = /\b(beer|ale|lager|stout|porter|ipa|pilsner|weiss|weizen|hefeweizen|witbier|saison|sour|pale ale|dark ale|craft beer|bier|cerveza|bière)\b/i

const ROSE_RX = /\b(ros[eé]|rosado|rosato|blush)\b/i

const SPARKLING_RX = /\b(champagne|prosecco|cava|cremant|crémant|sekt|spumante|frizzante|mousseux|sparkling|pét.?nat|petillant|franciacorta)\b/i

const WHITE_RX = /\b(blanc|white|bianco|blanco|weiss|weisswein|chardonnay|sauvignon blanc|riesling|pinot gr(is|igio)|gewurztraminer|gewürztraminer|viognier|chenin|muscat|albarino|albariño|verdejo|torront[eé]s|greco|fiano|vermentino|arneis|gavi|soave|chablis|burgundy blanc|white burgundy)\b/i

const RED_RX = /\b(rouge|red|rosso|tinto|rot\b|shiraz|syrah|cabernet|merlot|pinot noir|malbec|tempranillo|grenache|garnacha|rioja|barolo|barbaresco|amarone|brunello|chianti|montepulciano|sangiovese|nero d'avola|primitivo|zinfandel|carmenere|carménère|touriga|douro|port|porto)\b/i

export function classifyItem(name: string, description?: string | null): { category: Category; wine_type: WineType } {
  const text = `${name} ${description ?? ''}`.toLowerCase()

  if (SPIRITS_RX.test(text)) return { category: 'spirits', wine_type: null }
  if (BEER_RX.test(text)) return { category: 'beer', wine_type: null }

  // Default to wine for anything else (this is a wine/spirits price list)
  let wine_type: WineType = null
  if (ROSE_RX.test(text)) wine_type = 'rose'
  else if (SPARKLING_RX.test(text)) wine_type = 'sparkling'
  else if (WHITE_RX.test(text)) wine_type = 'white'
  else if (RED_RX.test(text)) wine_type = 'red'

  return { category: 'wine', wine_type }
}
