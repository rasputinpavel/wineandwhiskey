// Grape varieties for the Grape field autocomplete. Generic blends come first as
// quick picks, then every named variety alphabetically. The datalist filters as
// you type, and any value is still allowed (free text) for anything not listed.

// Generic blends (no grape breakdown) — pick one and leave it as the whole value.
const BLENDS = ['Red Blend', 'White Blend', 'Rosé Blend', 'Sparkling Blend', 'Field Blend']

const VARIETIES = [
  'Aglianico', 'Albariño', 'Barbera', 'Cabernet Franc', 'Cabernet Sauvignon', 'Carménère',
  'Chardonnay', 'Chenin Blanc', 'Corvina', 'Cortese', 'Fiano', 'Garganega', 'Gewürztraminer',
  'Glera', 'Greco', 'Grenache', 'Grillo', 'Grüner Veltliner', 'Malbec', 'Marsanne', 'Merlot',
  'Montepulciano', 'Moscato', 'Mourvèdre', 'Muscat', 'Nebbiolo', 'Negroamaro', 'Nero d’Avola',
  'Petit Verdot', 'Pinot Grigio', 'Pinot Gris', 'Pinot Noir', 'Pinotage', 'Primitivo',
  'Riesling', 'Rkatsiteli', 'Roussanne', 'Sangiovese', 'Saperavi', 'Sauvignon Blanc', 'Sémillon',
  'Shiraz', 'Syrah', 'Tannat', 'Tempranillo', 'Torrontés', 'Touriga Nacional', 'Trebbiano',
  'Verdejo', 'Verdicchio', 'Vermentino', 'Viognier', 'Zinfandel',
].sort((a, b) => a.localeCompare(b))

export const GRAPES: string[] = [...BLENDS, ...VARIETIES]
