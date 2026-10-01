// Словарь сортов для среза прайса. Намеренно маленький и расширяемый одной
// строкой: тут только то, что реально встречается в прайсах наших поставщиков.
//
// ВАЖНО про псевдонимы: они проверяются подстрокой, поэтому слишком короткий
// псевдоним ломает подсчёт блендов. Например, alias 'cabernet' у cabernet
// sauvignon засчитал бы «Cabernet Franc» как два сорта и пометил моносорт
// блендом. Поэтому псевдонимы держим полными.
export const GRAPE_SYNONYMS: Record<string, string[]> = {
  chardonnay:           ['chardonnay'],
  'sauvignon blanc':    ['sauvignon blanc'],
  'pinot gris':         ['pinot gris', 'pinot grigio', 'grauburgunder'],
  'pinot blanc':        ['pinot blanc', 'weissburgunder'],
  'pinot noir':         ['pinot noir', 'spatburgunder', 'blauburgunder'],
  riesling:             ['riesling'],
  'cabernet sauvignon': ['cabernet sauvignon'],
  'cabernet franc':     ['cabernet franc'],
  merlot:               ['merlot'],
  syrah:                ['syrah', 'shiraz'],
  malbec:               ['malbec'],
  tempranillo:          ['tempranillo', 'tinta roriz'],
  garnacha:             ['garnacha', 'grenache', 'cannonau'],
  sangiovese:           ['sangiovese', 'brunello', 'nielluccio'],
  nebbiolo:             ['nebbiolo', 'spanna'],
  barbera:              ['barbera'],
  montepulciano:        ['montepulciano'],
  corvina:              ['corvina'],
  aglianico:            ['aglianico'],
  zinfandel:            ['zinfandel', 'primitivo'],
  carmenere:            ['carmenere'],
  mourvedre:            ['mourvedre', 'monastrell'],
  'petit verdot':       ['petit verdot'],
  carignan:             ['carignan'],
  semillon:             ['semillon'],
  viognier:             ['viognier'],
  'chenin blanc':       ['chenin blanc'],
  gewurztraminer:       ['gewurztraminer', 'traminer'],
  'gruner veltliner':   ['gruner veltliner', 'gruner'],
  albarino:             ['albarino', 'alvarinho'],
  verdejo:              ['verdejo'],
  verdicchio:           ['verdicchio'],
  vermentino:           ['vermentino'],
  glera:                ['glera', 'prosecco'],
  muscat:               ['muscat', 'moscato', 'muskat'],
  trebbiano:            ['trebbiano', 'ugni blanc'],
  torrontes:            ['torrontes'],
  saperavi:             ['saperavi'],
  rkatsiteli:           ['rkatsiteli'],
}

/** Нормализация для сравнения: без диакритики, в нижнем регистре, одиночные пробелы. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Любой псевдоним → канон. Незнакомое возвращаем свёрнутым, но как есть. */
export function normalizeGrape(raw: string): string {
  const s = fold(raw)
  for (const [canon, aliases] of Object.entries(GRAPE_SYNONYMS)) {
    if (aliases.some((a) => fold(a) === s)) return canon
  }
  return s
}

/** Что искать в тексте прайса для данного канона. */
export function grapeNeedles(canon: string): string[] {
  return GRAPE_SYNONYMS[canon] ?? [canon]
}

/** Сколько РАЗНЫХ известных сортов упомянуто. >1 — признак бленда. */
export function countKnownGrapes(text: string | null): number {
  if (!text) return 0
  const h = fold(text)
  let n = 0
  for (const aliases of Object.values(GRAPE_SYNONYMS)) {
    if (aliases.some((a) => h.includes(fold(a)))) n += 1
  }
  return n
}
