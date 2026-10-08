import { describe, it, expect } from 'vitest'
import { isLovely } from './lovely'

describe('isLovely', () => {
  it('matches on filename without reading the PDF', async () => {
    expect(await isLovely(Buffer.from(''), 'Lovely Wines Catalog_Sep Claudio.pdf')).toBe(true)
    expect(await isLovely(Buffer.from(''), 'lovely-sep.pdf')).toBe(true)
  })

  it('returns false for an unrelated filename with no readable PDF', async () => {
    expect(await isLovely(Buffer.from(''), 'random-supplier.pdf')).toBe(false)
  })
})

import { toIntPrice, catalogDate } from './lovely'

describe('toIntPrice', () => {
  it('strips thousands separators', () => {
    expect(toIntPrice('2,710')).toBe(2710)
    expect(toIntPrice('41,960')).toBe(41960)
    expect(toIntPrice('900')).toBe(900)
  })
  it('rejects empty and non-numeric cells', () => {
    expect(toIntPrice('')).toBeNull()
    expect(toIntPrice('N/A')).toBeNull()
    expect(toIntPrice('low stock')).toBeNull()
  })
})

describe('catalogDate', () => {
  it('reads the month from the filename and the year from ModDate', () => {
    expect(catalogDate('Lovely Wines Catalog_Sep Claudio.pdf', new Date('2026-09-01')))
      .toBe('2026-09-01')
  })
  it('prefers an explicit YYYY-MM in the filename', () => {
    expect(catalogDate('lovely-2026-11.pdf', new Date('2026-09-01'))).toBe('2026-11-01')
  })
  it('falls back to ModDate when the filename has no month', () => {
    expect(catalogDate('catalog.pdf', new Date('2026-09-01'))).toBe('2026-09-01')
  })
  it('returns null when there is nothing to go on', () => {
    expect(catalogDate('catalog.pdf', null)).toBeNull()
  })
})

import { matchType } from './lovely'

describe('matchType', () => {
  it('reads wine colour codes', () => {
    expect(matchType("R           Blason d'Issan - Margaux")).toEqual({
      type: { category: 'wine', wineType: 'red', spiritType: null, note: null },
      rest: "Blason d'Issan - Margaux",
    })
    expect(matchType('W    Some White')?.type.wineType).toBe('white')
    expect(matchType('RO   Some Rose')?.type.wineType).toBe('rose')
    expect(matchType('SP   Some Sparkling')?.type.wineType).toBe('sparkling')
  })

  it('treats champagne as sparkling', () => {
    expect(matchType("CP     Canard Duchene Champagne 'Cuvee Leonie' Brut")?.type)
      .toEqual({ category: 'wine', wineType: 'sparkling', spiritType: null, note: 'Champagne' })
  })

  it('prefers the two-word code over its first word', () => {
    const m = matchType('CP RO Goutorbe-Bouillot Champagne Rose Brut')
    expect(m?.type.wineType).toBe('sparkling')
    expect(m?.type.note).toContain('Rosé')
    expect(m?.rest).toBe('Goutorbe-Bouillot Champagne Rose Brut')
  })

  it('keeps dessert and fortified codes as wine with no colour', () => {
    expect(matchType('DW   Tokaji Aszu')?.type)
      .toEqual({ category: 'wine', wineType: null, spiritType: null, note: 'Dessert wine' })
    expect(matchType('FW   Some Port')?.type.category).toBe('wine')
  })

  it('reads spirits words glued to the product name', () => {
    expect(matchType('Armagnac Gelas, Bas Armagnac 8 Ans')).toEqual({
      type: { category: 'spirits', wineType: null, spiritType: 'armagnac', note: null },
      rest: 'Gelas, Bas Armagnac 8 Ans',
    })
    expect(matchType('Eau-de-Vie Gelas, Vielle Eau De Vie De Prune')?.type.spiritType)
      .toBe('eau-de-vie')
    expect(matchType('Rhum     Arhumatic Punch Au Rhum')?.type.spiritType).toBe('rum')
    expect(matchType('Ceylon   Ceylon Arrack')?.type.spiritType).toBe('arrack')
  })

  it('keeps sherry and vermouth as wine, not spirits', () => {
    expect(matchType('Sherry   Lustau Amontillado')?.type)
      .toEqual({ category: 'wine', wineType: null, spiritType: null, note: 'Sherry' })
    expect(matchType('Vermouth Some Vermouth')?.type.category).toBe('wine')
  })

  it('returns null when nothing in the vocabulary matches', () => {
    expect(matchType('Domaine Philippe Cheron, Chambolle-Musigny')).toBeNull()
    expect(matchType('')).toBeNull()
  })
})

describe('toIntPrice — thousands grammar, not merely shape', () => {
  it('rejects malformed thousands groups instead of dropping a digit', () => {
    // '41,96' silently became 4196 and '1,2,3' became 123 — a plausible-looking
    // wrong purchase price, the exact failure the file header warns about.
    expect(toIntPrice('41,96')).toBeNull()
    expect(toIntPrice('1,2,3')).toBeNull()
    expect(toIntPrice('1,0200')).toBeNull()
    expect(toIntPrice(',500')).toBeNull()
    expect(toIntPrice('500,')).toBeNull()
  })

  it('still accepts every well-formed price in the catalog', () => {
    expect(toIntPrice('1,020')).toBe(1020)
    expect(toIntPrice('17,280')).toBe(17280)
    expect(toIntPrice('90,600')).toBe(90600)   // the dearest bottle in the file
    expect(toIntPrice('  2,710  ')).toBe(2710)
    expect(toIntPrice('900')).toBe(900)
  })
})

// Real header and row from page 48 of the September 2026 catalog. The supplier
// mistyped this price with a dot — "1.020" where every other row uses a comma.
import { readFileSync as readFixture } from 'fs'
import { join as joinPath } from 'path'

describe('catalogDate — month matching', () => {
  const SEP = new Date('2026-09-01T00:00:00Z')

  it('does not take a word that merely starts with a month prefix', () => {
    // Janhom is another supplier in this repo, so a co-import filename is real.
    expect(catalogDate('Decanter-top-100.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Novelties.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Junmai-sake-list.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Marlborough.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Janhom price.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Marchesi-di-Barolo.pdf', SEP)).toBe('2026-09-01')
  })

  it('looks only at the basename, never at the directories above it', () => {
    expect(catalogDate('/Users/me/Nov-drafts/catalog.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('/archive/2026-11/catalog.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('C:\\lists\\Dec\\catalog.pdf', SEP)).toBe('2026-09-01')
  })

  it('still reads abbreviations and full month names', () => {
    expect(catalogDate('Lovely Wines Catalog_Sep Claudio.pdf', SEP)).toBe('2026-09-01')
    expect(catalogDate('Lovely Wines November.pdf', SEP)).toBe('2026-11-01')
    expect(catalogDate('lovely-may.pdf', SEP)).toBe('2026-05-01')
    expect(catalogDate('lovely-sept.pdf', SEP)).toBe('2026-09-01')
  })

  it('picks the year that puts the labelled month nearest the ModDate', () => {
    // A January catalog mailed in late December belongs to the coming January,
    // not to the January eleven months past.
    expect(catalogDate('lovely-Jan.pdf', new Date('2026-12-28T00:00:00Z'))).toBe('2027-01-01')
    expect(catalogDate('lovely-Dec.pdf', new Date('2027-01-05T00:00:00Z'))).toBe('2026-12-01')
    expect(catalogDate('lovely-Sep.pdf', SEP)).toBe('2026-09-01')
  })

  it('reads the ModDate in the catalog\u2019s own timezone', () => {
    // The PDF is stamped 2026-09-01 00:30 Bangkok. Formatted in UTC — which is
    // what Railway containers run on — that is 31 August, the wrong month for a
    // price list whose freshness decides which catalog is current.
    expect(catalogDate('catalog.pdf', new Date('2026-08-31T17:30:00Z'))).toBe('2026-09-01')
  })
})

import { vi } from 'vitest'
import type { TypeInfo } from './lovely'
import { classifyTypeCell } from './lovely'

describe('classifyTypeCell', () => {
  it('matches the known vocabulary', () => {
    expect(classifyTypeCell('R   Some Red')).toMatchObject({ kind: 'matched', rest: 'Some Red' })
    expect(classifyTypeCell('Armagnac Gelas, Bas Armagnac 8 Ans'))
      .toMatchObject({ kind: 'matched', rest: 'Gelas, Bas Armagnac 8 Ans' })
  })

  it('calls prose and product names what they are: no Type cell', () => {
    expect(classifyTypeCell('Domaine Philippe Cheron, Chambolle-Musigny')).toEqual({ kind: 'none' })
    expect(classifyTypeCell('')).toEqual({ kind: 'none' })
    expect(classifyTypeCell('Javelier-Laurin, Bourgogne Pinot Noir')).toEqual({ kind: 'none' })
  })

  it('reports a Type cell it does not know, rather than shrugging', () => {
    // A Tequila or Sake section next month must not vanish without a word.
    expect(classifyTypeCell('Tequila   Patron Silver')).toEqual({ kind: 'unknown', token: 'Tequila' })
    expect(classifyTypeCell('Mezcal    Del Maguey Vida')).toEqual({ kind: 'unknown', token: 'Mezcal' })
    expect(classifyTypeCell('Sake      Dassai 23')).toEqual({ kind: 'unknown', token: 'Sake' })
    expect(classifyTypeCell('Port      Taylor 10 Year Old')).toEqual({ kind: 'unknown', token: 'Port' })
  })

  it('reports a known word in unexpected case instead of silently accepting it', () => {
    expect(classifyTypeCell('RUM        Ron Barcelo Blanco')).toEqual({ kind: 'unknown', token: 'RUM' })
    expect(classifyTypeCell('whisky     Some Whisky')).toEqual({ kind: 'unknown', token: 'whisky' })
  })
})

describe('matchType — loud about what it cannot read', () => {
  it('warns on an unrecognised Type cell and still fails closed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(matchType('Tequila   Patron Silver')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[lovely]')
    expect(warn.mock.calls[0][0]).toContain('Tequila')
    warn.mockRestore()
  })

  it('stays quiet on prose', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(matchType('Domaine Philippe Cheron, Chambolle-Musigny')).toBeNull()
    expect(matchType('')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stays quiet and returns the match on a known Type cell', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(matchType('CP     Paul Bara Champagne')?.type.wineType).toBe('sparkling')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

// ─── Golden table over the committed fixture ───────────────────────────────
//
// Every product row of the five fixture pages, with the cells each one must
// yield. The expected values were read off the raw pdftotext output — token
// positions inspected line by line — not captured from this parser's own
// output, which would only have enshrined whatever it did at the time.
//
// This is a broad regression net, not a substitute for the targeted cases above.
// Checked by mutation: reintroducing the flat search window, the unbounded price
// regex, the vintage-as-price bug or the unbounded size regex leaves all 70 rows
// here unchanged, because these five pages happen not to print the geometry that
// triggers any of them. The row that actually breaks on a dotted price lives on
// page 48 and is pinned by its own test, with its real header, further up.
//
// `type: ''` marks a line that genuinely carries no Type cell: a bottle-size
// variant row, or a row whose type code pdftotext put on a line of its own
// above it (the stock-remark shape). Row assembly, not cell reading, is what
// later reunites those with their code and strips the stock prefix off `name`.

describe('classifyTypeCell — a lone word is not a Type cell unless it could be a code', () => {
  it('treats page banners as prose, not as unknown Type cells', () => {
    // Later row assembly runs every line of a block through matchType, and the
    // catalog is full of lone all-caps banners. Reporting each one as an
    // unrecognised Type cell would bury the warning that matters in noise.
    for (const banner of ['SPIRITS', 'CHAMPAGNE', 'FRANCE', 'ARGENTINA', 'DOMINICAN']) {
      expect(classifyTypeCell(banner), banner).toEqual({ kind: 'none' })
    }
  })

  it('still reports a lone token short enough to be a new type code', () => {
    expect(classifyTypeCell('XX')).toEqual({ kind: 'unknown', token: 'XX' })
  })

  it('still reports an unknown word that has a product name after it', () => {
    expect(classifyTypeCell('TEQUILA   Patron Silver')).toEqual({ kind: 'unknown', token: 'TEQUILA' })
  })

  it('does not warn its way through the whole fixture', () => {
    // Mirrors exactly what the parser feeds matchType: the left-hand text of
    // every row inside a beverage table, stock prefix stripped. A warning here
    // would mean a real product the parser cannot read.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const words of BBOX_PAGES) {
      let columns: ReturnType<typeof tableColumns> = null
      for (const row of liftStockRows(wordRows(words)).rows) {
        if (row.words[0].text === 'Type' || row.words[0].text === 'CODE') {
          columns = tableColumns(row)
          continue
        }
        if (!columns) continue
        matchType(splitStockPrefix(rowCells(row, columns).left).rest)
      }
    }
    const unreadable = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('unrecognised Type cell'))
    expect(unreadable).toEqual([])
    warn.mockRestore()
  })
})

describe('classifyTypeCell — short all-caps banners are banners', () => {
  it('ignores region and country banners however short', () => {
    for (const b of ['LOIRE', 'ITALY', 'SPAIN', 'CHILE', 'USA', 'LODI', 'TORO', 'RHONE', 'MOSEL', 'CAVA', 'PAGO']) {
      expect(classifyTypeCell(b), b).toEqual({ kind: 'none' })
    }
  })

  it('still reports a lone token shaped like one of this catalog’s codes', () => {
    expect(classifyTypeCell('XX')).toEqual({ kind: 'unknown', token: 'XX' })
    expect(classifyTypeCell('XY ZW')).toEqual({ kind: 'unknown', token: 'XY ZW' })
  })
})

// ─── Task 5: row assembly ──────────────────────────────────────────────────
//
// The fixture holds seventeen pages. They are addressed by content, never by
// position: the next person to append a page must not have to renumber tests,
// and several already have been appended since this line was written.

import { bboxPages, wordRows, rowText, liftStockRows, tableColumns, rowCells } from './lovely'
import type { Word } from './lovely'

// The parser reads word coordinates, so the fixture is a `pdftotext -bbox` dump
// of 22 pages — every page the tests below name, including 14 (Hermandad) and 57
// (Au Bon Climat, whose name comes closest in the catalog to its size cell).
const BBOX = readFixture(joinPath(__dirname, '../__fixtures__/lovely-bbox.xml'), 'utf8')
const BBOX_PAGE_RE = /<page\b[^>]*>[\s\S]*?<\/page>/g
const BBOX_PAGE_XML = BBOX.match(BBOX_PAGE_RE) ?? []
const BBOX_PAGES = bboxPages(BBOX)

// Addressed by content, never by position: appending a page must not renumber a
// single test. Throws rather than returning undefined, so a mistyped marker
// fails as itself instead of as an empty parse.
function pageIndex(marker: string): number {
  const hits = BBOX_PAGES
    .map((words, i) => [i, words.map(w => w.text).join(' ')] as const)
    .filter(([, text]) => text.includes(marker))
  if (hits.length !== 1) {
    throw new Error(`bbox fixture: ${hits.length} pages contain ${JSON.stringify(marker)}, want exactly 1`)
  }
  return hits[0][0]
}

// The one page's raw XML, which is what parseCatalogXml takes.
const pageXml = (marker: string) => BBOX_PAGE_XML[pageIndex(marker)]
const coords = (marker: string) => BBOX_PAGES[pageIndex(marker)]

import { splitStockPrefix } from './lovely'

describe('splitStockPrefix', () => {
  it('lifts a stock remark off the front of a product name', () => {
    expect(splitStockPrefix('low stock    Chateau La Pensee Lalande de Pomerol'))
      .toEqual({ stock: 'low stock', rest: 'Chateau La Pensee Lalande de Pomerol' })
    expect(splitStockPrefix('out of stock    Javelier-Laurin, Bourgogne Pinot Noir'))
      .toEqual({ stock: 'out of stock', rest: 'Javelier-Laurin, Bourgogne Pinot Noir' })
  })

  it('lifts the torn halves the text layer leaves behind', () => {
    // pdftotext splits "low stock" around the type code: "low R" on one line,
    // "stock   <name>" on the next. Both halves must come off, or the code is
    // lost and "stock" becomes an unrecognised Type cell.
    expect(splitStockPrefix('low R')).toEqual({ stock: 'low', rest: 'R' })
    expect(splitStockPrefix("stock   Chateau Cos d'Estournel Saint-Estephe"))
      .toEqual({ stock: 'stock', rest: "Chateau Cos d'Estournel Saint-Estephe" })
    expect(splitStockPrefix('low stock')).toEqual({ stock: 'low stock', rest: '' })
    expect(splitStockPrefix('out of stock')).toEqual({ stock: 'out of stock', rest: '' })
  })

  it('leaves everything else alone', () => {
    expect(splitStockPrefix("R   Blason d'Issan")).toEqual({ stock: '', rest: "R   Blason d'Issan" })
    expect(splitStockPrefix('Lowland Single Malt')).toEqual({ stock: '', rest: 'Lowland Single Malt' })
    expect(splitStockPrefix('')).toEqual({ stock: '', rest: '' })
  })
})

import { parseCatalogXml } from './lovely'
import type { ExtractedItem } from '../claude'

// Finds the one position whose name contains every fragment given. Throws when
// that is not exactly one position, so a renamed product fails as itself.
function one(items: ExtractedItem[], ...fragments: string[]): ExtractedItem {
  const hits = items.filter(i => fragments.every(f => i.name.includes(f)))
  if (hits.length !== 1) {
    throw new Error(`${hits.length} positions match ${JSON.stringify(fragments)}: ${JSON.stringify(hits.map(h => h.name))}`)
  }
  return hits[0]
}

describe('parseCatalogXml — tables, banners and whole data rows', () => {
  it('yields nothing at all from the glassware and ashtray page', () => {
    const items = parseCatalogXml(pageXml('ZALTO GLASPERFEKTION'))
    expect(items).toEqual([])
  })

  it('reads the spirits page whose Type words are glued to the product name', () => {
    const items = parseCatalogXml(pageXml('MAISON GELAS'))
    expect(items).toHaveLength(27)

    const barcelo = one(items, 'Ron Barcelo Blanco Anejado')
    expect(barcelo).toMatchObject({
      price: 1300, volume: '700ml', category: 'spirits', spirit_type: 'rum',
      country: 'Dominican Republic', year: null, wine_type: null,
      grape_variety: null, supplier_sku: null,
    })

    expect(one(items, 'Bas Armagnac 8 Ans'))
      .toMatchObject({ price: 3125, spirit_type: 'armagnac', country: 'France' })
    expect(one(items, 'Bas Armagnac 60 Ans').price).toBe(41960)
  })

  it('takes the country from the page banner and the region from the sub-banner', () => {
    const items = parseCatalogXml(pageXml('CHATEAU HAUT POUGNAN'))
    const pougnan = one(items, 'Chateau Haut Pougnan Sauvignon')
    expect(pougnan).toMatchObject({
      country: 'France', region: 'Entre-Deux-Mers, Bordeaux',
      wine_type: 'white', category: 'wine', year: 2021, price: 1170,
    })
    // The U+2011 banner one producer earlier must not leak into this one, and
    // must itself be read: an ASCII-only matcher drops it silently.
    expect(one(items, 'Chateau La Loubiere').region).toBe('Entre‑Deux‑Mers, Bordeaux')
  })

  it('carries the producer paragraph into the description', () => {
    const items = parseCatalogXml(pageXml('MAISON GELAS'))
    expect(one(items, 'Bas Armagnac 8 Ans').description)
      .toContain('Gelas Bas-Armagnac is celebrated')
  })
})

// A compact view of one product's positions: volume / year / price.
function shape(items: ExtractedItem[], ...fragments: string[]): string[] {
  return items
    .filter(i => fragments.every(f => i.name.includes(f)))
    .map(i => `${i.volume ?? '-'}/${i.year ?? '-'}/${i.price ?? '-'}`)
}

// The same, for a name that is a prefix of another product's name.
function shapeOf(items: ExtractedItem[], name: string): string[] {
  return items
    .filter(i => i.name === name)
    .map(i => `${i.volume ?? '-'}/${i.year ?? '-'}/${i.price ?? '-'}`)
}

describe('the centring rule — a cell alone on its line serves its neighbours', () => {
  it('gives a name row centred between size rows both of its sizes', () => {
    const items = parseCatalogXml(pageXml('CANARD-DUCHÊNE'))
    expect(shape(items, "'Cuvee Leonie' Brut", 'Rose')).toEqual(['750ml/-/3000'])
    expect(shapeOf(items, "Canard Duchene Champagne 'Cuvee Leonie' Brut").sort())
      .toEqual(['1500ml/-/5520', '750ml/-/2710'])
    expect(one(items, 'Canard-Duchene Champagne Brut').year).toBe(2015)
    expect(one(items, "'P.181'").year).toBeNull()
    expect(items).toHaveLength(16)
    for (const i of items) {
      expect(i, i.name).toMatchObject({ category: 'wine', wine_type: 'sparkling', country: 'France' })
    }
  })

  it('never lets a row that has its own size and price absorb a neighbour', () => {
    // Goutorbe-Bouillot: the 750ml / 2,010 row belongs to 'Reflets De Riviere'
    // above it, whose own line carries neither a size nor a price. Hand it to
    // 'Le Ru Des Charmes' below instead and that wine lands in the database at
    // 2,010 when it really costs 2,570 — a plausible wrong price.
    const items = parseCatalogXml(pageXml('GOUTORBE-BOUILLOT'))
    expect(shape(items, "'Le Ru Des Charmes'")).toEqual(['750ml/-/2570'])
    expect(shape(items, "'Reflets De Riviere'").sort()).toEqual(['375ml/-/1440', '750ml/-/2010'])
  })

  it('lets a vintage-variant row inherit the size from its name row', () => {
    // Without inheritance both of these land with volume: null.
    const items = parseCatalogXml(pageXml('ALDRIDGE'))
    expect(shape(items, "'Twynham' Chardonnay")).toEqual(['750ml/2024/590', '750ml/2025/-'])
    expect(shape(items, "'Rams Head'")).toEqual(['750ml/2023/590', '750ml/2024/-'])
  })

  it('spreads a single price over the vintages centred against it', () => {
    const tollo = parseCatalogXml(pageXml('CANTINA TOLLO'))
    expect(shape(tollo, "'Rocca Ventosa' Pinot Grigio"))
      .toEqual(['750ml/2023/840', '750ml/2024/840', '750ml/2025/840'])

    const yangarra = parseCatalogXml(pageXml('YANGARRA ESTATE VINEYARD'))
    expect(shape(yangarra, "'GSM'")).toEqual(['750ml/2017/2120', '750ml/2021/2120'])
  })

  it('pairs sizes, vintages and prices positionally when each is printed', () => {
    const muga = parseCatalogXml(pageXml('MUGA'))
    expect(shapeOf(muga, 'Muga Rose')).toEqual(['1500ml/2021/2320', '3000ml/2022/4770'])
    expect(shapeOf(muga, 'Muga Rose, Rioja DOC')).toEqual(['750ml/2023/1075'])
    expect(shape(muga, "'Prado Enea'"))
      .toEqual(['750ml/2011/3730', '750ml/2014/4260', '750ml/2016/4350'])
    expect(shape(muga, "'Conde De Haro' Cava Brut Reserva")).toEqual(['750ml/2021/1270'])
    expect(shapeOf(muga, "Muga Conde De Haro Cava Brut 'Rose’"))
      .toEqual(['750ml/2021/1375', '750ml/2022/1375'])
  })

  it('keeps a complete row from stealing the cluster of the row below it', () => {
    // Giuseppe Cortese prints three vintages around the 500ml Recioto's own
    // 2018, and the Barbaresco rows either side of Rabaja carry everything of
    // their own. Both shapes come out of the same rule.
    const items = parseCatalogXml(pageXml('GIUSEPPE CORTESE'))
    expect(shape(items, 'Barbaresco, Rabaja')).toEqual(['750ml/2017/4105', '750ml/2019/4105'])
    expect(shape(items, 'Barbaresco Reserva')).toEqual(['750ml/2013/6920'])
    expect(shape(items, 'Langhe, Nebbiolo')).toEqual(['750ml/2022/1580'])

    const bussola = parseCatalogXml(pageXml('BUSSOLA TOMMASO'))
    expect(shape(bussola, "'Recioto' Della Valpolicella Classico TB").sort())
      .toEqual(['500ml/2017/3320', '500ml/2018/3320', '500ml/2019/-', '750ml/2008/5685'])
    expect(shape(bussola, 'Valpolicella Ripasso')).toEqual(['750ml/2019/1640', '750ml/2020/-'])
  })

  it('keeps every row of a five-row cluster with its own product', () => {
    const items = parseCatalogXml(pageXml('LA RIOJA ALTA'))
    expect(shape(items, "'Gran Reserva 904'"))
      .toEqual(['750ml/2015/4770', '750ml/2016/4770', '1500ml/2015/9540', '1500ml/2016/9540'])
    expect(shape(items, "'Gran Reserva 890'"))
      .toEqual(['750ml/2010/10500', '750ml/2011/10500', '1500ml/2010/21000'])
    expect(shape(items, "'El Camino'")).toEqual(['750ml/2021/6400'])
    expect(shape(items, "'Vina Ardanza'"))
      .toEqual(['375ml/2019/1210', '750ml/2019/2500', '750ml/2020/2500'])
    expect(shape(items, "'Vina Arana'")).toEqual(['750ml/2017/2757'])
  })
})

describe('a name wrapped around its type code is one product, not two', () => {
  it('joins the halves of a Realm Cellars name and files no junk position', () => {
    const items = parseCatalogXml(pageXml('REALM CELLARS'))
    expect(shapeOf(items, "Realm Cellars ‘Houyi Vineyard’ Napa Valley, Cabernet Sauvignon"))
      .toEqual(['750ml/2021/16360', '750ml/2022/12800'])
    // Emitting the continuation on its own would file a wine called
    // "Cabernet Sauvignon" at 12,800.
    expect(items.filter(i => i.name === 'Cabernet Sauvignon')).toEqual([])
    expect(shapeOf(items, 'Realm Estate, Moonracer'))
      .toEqual(['750ml/2021/20100', '750ml/2022/12800'])
  })

  it('joins a Yangarra name over its grape list', () => {
    const items = parseCatalogXml(pageXml('YANGARRA ESTATE VINEYARD'))
    expect([...new Set(items.filter(i => i.name.includes("'GSM'")).map(i => i.name))])
      .toEqual(["Yangarra Estae Vineyard 'GSM' (Grenache/ Shiraz/ Mourvèdre)"])
    expect(items.some(i => i.name.startsWith('(Grenache'))).toBe(false)
  })

  it('joins a Cantina Tollo name over its appellation', () => {
    const items = parseCatalogXml(pageXml('CANTINA TOLLO'))
    expect([...new Set(items.filter(i => i.name.includes('Pinot Grigio')).map(i => i.name))])
      .toEqual(["Cantina Tollo 'Rocca Ventosa' Pinot Grigio Terre di Chieti IGP"])
  })

  it('joins a name split mid-word and keeps each cluster its own', () => {
    const items = parseCatalogXml(pageXml('DOMAINE COMTESSE DE CHERISEY'))
    expect(shapeOf(items, "Comtesse de Cherisey, Meursault-Blagny, 1er Cru 'La Genelotte'"))
      .toEqual(['750ml/2018/7245'])
    expect(shapeOf(items, "Comtesse de Cherisey, Meursault 'Bois de Blagny'"))
      .toEqual(['750ml/2018/7245', '750ml/2019/7575', '750ml/2020/10280', '750ml/2021/10280'])
    // Eight lines, vintages and prices on alternating ones.
    expect(shapeOf(items, "Comtesse de Cherisey, Puligny-Montrachet, 1er Cru 'Hameau de Blagny'"))
      .toEqual(['750ml/2018/7750', '750ml/2019/8100', '750ml/2020/11000', '750ml/2021/11000'])
    expect(shapeOf(items, "Comtesse de Cherisey, Puligny-Montrachet, 1er Cru 'Les Chalumaux"))
      .toEqual(['750ml/2018/7245', '750ml/2019/7665', '750ml/2020/10280'])
  })

  it('does not turn a producer paragraph into a wine', () => {
    // A paragraph wraps out past the Size column and into the cell area; a name
    // fragment stops before it. Get that backwards and a sentence becomes a
    // phantom position with a price.
    for (const marker of ['YANGARRA ESTATE VINEYARD', 'REALM CELLARS', 'MAISON GELAS',
                          'DOMAINE COMTESSE DE CHERISEY', 'GIUSEPPE CORTESE']) {
      for (const item of parseCatalogXml(pageXml(marker))) {
        expect(item.name, marker).not.toMatch(/\b(is|are|the|and|with)\b/)
        expect(item.name.length, `${marker}: ${item.name}`).toBeLessThan(90)
      }
    }
  })
})

describe('stock remarks, torn type codes and lone Remark cells', () => {
  it('keeps the code and the name when a stock remark splits the row', () => {
    const items = parseCatalogXml(pageXml('JAVELIER-LAURIN'))
    const javelier = items.filter(i => i.name.startsWith('Javelier-Laurin'))
    expect(javelier.map(i => i.price)).toEqual([1500, 4490, 5900, 12150])
    for (const i of javelier) {
      expect(i, i.name).toMatchObject({
        country: 'France', region: 'Côte De Nuits, Burgundy',
        category: 'wine', wine_type: 'red', volume: '750ml',
      })
      expect(i.name).not.toMatch(/stock|^low|^out/)
    }
    expect(one(items, 'Javelier-Laurin, Bourgogne').description).toContain('out of stock')
    expect(one(items, 'Ruchottes-Chambertin').description).toContain('out of stock')
    expect(one(items, "'Les Champs Chenys'").description).toContain('low stock')
  })

  it('reads a row whose stock remark is printed before the name', () => {
    const items = parseCatalogXml(pageXml('CHATEAU LA PENSEE'))
    const pensee = one(items, 'Chateau La Pensee Lalande de Pomerol')
    expect(pensee).toMatchObject({ price: 1450, year: 2020, wine_type: 'red', volume: '750ml' })
    expect(pensee.description).toContain('low stock')
    expect(pensee.name).toBe('Chateau La Pensee Lalande de Pomerol')
  })

  it('reassembles a stock remark torn across the type code', () => {
    // "low R" on one line, "stock   <name>" on the next. Lose the halves and
    // the type code goes with them, leaving a position with no category.
    const cos = one(parseCatalogXml(pageXml("CHATEAU COS D'ESTOURNEL")), "Cos d'Estournel")
    expect(cos).toMatchObject({ name: "Chateau Cos d'Estournel Saint-Estephe", wine_type: 'red', price: 9440 })
    expect(cos.description).toContain('low stock')

    const melka = one(parseCatalogXml(pageXml('MELKA')), '(Bordeaux Blend)')
    expect(melka).toMatchObject({ wine_type: 'red', price: 11030, year: 2017 })
    expect(melka.description).toContain('low stock')
  })

  it('gives a product both of the ratings centred around it', () => {
    const items = parseCatalogXml(pageXml('PAUL BARA'))
    const reserve = one(items, "'Reserve Brut'")
    expect(reserve.description).toContain('91 WS')
    expect(reserve.description).toContain('90 VN')
    // ...and does not hand them to the neighbour below, which prints its own.
    expect(one(items, "'Grand Rose Brut'").description).not.toMatch(/WS|VN/)
  })

  it('hands a lone rating to the row below when the row above has its own', () => {
    const items = parseCatalogXml(pageXml("O'SHAUGHNESSY"))
    const howell = items.filter(i => i.name.includes("'Howell Mountain'"))
    expect(howell).toHaveLength(2)
    expect(howell[0].description).toContain('87WE 93JS')
    const y2017 = items.filter(i => i.name === "O'Shaughnessy Napa Valley Cabernet Sauvignon" && i.year === 2017)
    expect(y2017).toHaveLength(1)
    expect(y2017[0].description).toContain('93 JS')
    expect(y2017[0].description).toContain('90 RP')
  })

  it('keeps a rating out of the price column', () => {
    expect(one(parseCatalogXml(pageXml('MELKA')), "'Metisse' Jumping Goat").price).toBe(11400)
    // Prints "100 JS" in the Remark column and no price of its own on that line.
    const high = parseCatalogXml(pageXml('YANGARRA ESTATE VINEYARD'))
      .filter(i => i.name.includes('High Sands Grenache'))
    expect(high.map(i => i.price)).toEqual([null, 7760])
    expect(high[0].description).toContain('100 JS')
  })
})

describe('prices the catalog prints oddly', () => {
  it('reads a price whose thousands separator is a dot, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cortese = parseCatalogXml(pageXml('GIUSEPPE CORTESE'))
    const muga = parseCatalogXml(pageXml('MUGA'))
    const said = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('thousands') || m.includes('a dot where'))
    warn.mockRestore()

    expect(shape(cortese, "Barbera D'Alba Morassina"))
      .toEqual(['750ml/2018/1970', '750ml/2019/1970'])
    // Two separate clusters print the same name, so all five rows are listed.
    expect(shapeOf(muga, 'Muga Reserva, Rioja DOC')).toEqual([
      '375ml/2021/1020', '375ml/2022/-', '1500ml/2021/3270',
      '750ml/2021/1610', '750ml/2022/1610',
    ])
    expect(said).toHaveLength(2)
    expect(said.join('\n')).toContain('1.970')
    expect(said.join('\n')).toContain('1.020')
  })

  it('keeps "pending" as a position with no price rather than dropping it', () => {
    const items = parseCatalogXml(pageXml('TOLAINI'))
    expect(one(items, "'Valdisanti'")).toMatchObject({ year: 2022, price: null, volume: '750ml' })
    // Two sizes and two vintages against one printed price.
    expect(shape(items, "'Al Passo'")).toEqual(['750ml/2020/1300', '1500ml/2022/1300'])
  })

  it('files a dessert-wine code as wine with no colour', () => {
    const monsanto = one(parseCatalogXml(pageXml('CASTELLO DI MONSANTO')), "'La Chimera'")
    expect(monsanto).toMatchObject({ category: 'wine', wine_type: null, price: 3151, volume: '375ml' })
    expect(monsanto.description).toMatch(/dessert/i)
  })
})

// Censuses of the coordinate fixture. Numbers, not contracts about how many
// pages the file holds — appending a page moves them.
const COORD_FIXTURE_POSITIONS = 440
const COORD_FIXTURE_UNPRICED = 22

describe('invariants over every page of the fixture', () => {
  const items = (() => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = parseCatalogXml(BBOX)
    warn.mockRestore()
    return all
  })()

  it('parses every page without losing or inventing a table', () => {
    expect(items).toHaveLength(COORD_FIXTURE_POSITIONS)
  })

  it('lets no glassware through under any name', () => {
    for (const i of items) {
      expect(i.name, i.name).not.toMatch(/Zalto|Josephine|Usuhari|Daiginjo|Ashtray|Spittoon/i)
    }
  })

  it('never leaves a position without a category or a country', () => {
    expect(items.filter(i => !i.category)).toEqual([])
    expect(items.filter(i => !i.country)).toEqual([])
  })

  it('never leaves a cell fragment inside a product name', () => {
    for (const i of items) {
      expect(i.name, i.name).not.toMatch(/\d{2,4}\s?m[lL]\b/)
      expect(i.name, i.name).not.toMatch(/stock/i)
      expect(i.name.length, i.name).toBeGreaterThanOrEqual(4)
    }
    // One real product is printed with a leading digit, and only one.
    expect([...new Set(items.filter(i => /^\d/.test(i.name)).map(i => i.name))])
      .toEqual(['30&40 Double Jus (Aperitive de Normandie)'])
  })

  it('gives every position a volume, here and over the whole catalog', () => {
    // True catalog-wide, not only of the fixture: the last row without a volume
    // was the Tesseron Extreme Rare Cognac, whose "1,500ml" the size cell now
    // accepts. Its table is in the fixture, so a regression shows up here.
    expect(items.filter(i => !i.volume)).toEqual([])
  })

  it('leaves a price out only where the catalog prints none', () => {
    // Rows printing "pending", two Tesseron Cognacs printing "Request for
    // Quote", and Giuseppe Cortese's Langhe Bianco 'Scapulin', the one row whose
    // Price column is simply empty.
    const unpriced = items.filter(i => i.price === null)
    expect(unpriced).toHaveLength(COORD_FIXTURE_UNPRICED)
    expect(unpriced.filter(i => i.name.includes('Scapulin'))).toHaveLength(1)
  })
})

describe('ambiguous clusters are named out loud', () => {
  // In some clusters the text layer genuinely does not record which year goes
  // with which price: Yangarra prints two vintages against one price value.
  // Those are paired positionally and reported, so a human can check them.
  function reported(marker: string): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseCatalogXml(pageXml(marker))
    const said = warn.mock.calls.map(c => String(c[0]))
    warn.mockRestore()
    return said
  }

  it('names only the clusters that print two or more different prices', () => {
    // Yangarra's 'GSM' prints two vintages against one price of 2,120: every
    // vintage gets that price and nothing can be mispaired, so it is counted,
    // not named. Naming all 213 of those buried the one that matters.
    const said = reported('YANGARRA')
    expect(said.filter(m => m.includes('ambiguous cluster'))).toEqual([])
    expect(said.filter(m => /\d+ clusters print one price/.test(m))).toHaveLength(1)

    // Domaine J.A. Ferret's 'Tournant De Pouilly' prints four vintages against
    // 3,630 and 3,880 — the one genuinely ambiguous shape in the catalog.
    const ferret = reported('FERRET').filter(m => m.includes('ambiguous cluster'))
    expect(ferret).toHaveLength(1)
    expect(ferret[0]).toContain('Tournant')
    expect(ferret[0]).toContain('3630')
    expect(ferret[0]).toContain('3880')
  })

  it('stays quiet when every vintage has a price of its own', () => {
    // Canard-Duchêne's multi-size wine has two sizes, two prices and one
    // vintage — nothing about it is ambiguous.
    expect(reported('CANARD-DUCHÊNE').filter(m => m.includes('ambiguous'))).toEqual([])
    expect(reported('GELAS').filter(m => m.includes('ambiguous'))).toEqual([])
  })
})

describe('two shapes the full catalog turned up', () => {
  it('reads the stock fragment glued straight onto the type code', () => {
    // "lowR" with no space at all, twice in the catalog. Left alone it becomes a
    // product named "lowR", the code goes with it, and the real row below —
    // Blason d'Issan at 1,845 — lands with no category and is dropped.
    const items = parseCatalogXml(pageXml('CHÂTEAU D’ISSAN'))
    const blason = one(items, "Blason d'Issan")
    expect(blason).toMatchObject({
      name: "Blason d'Issan - Margaux", price: 1845, year: 2021,
      volume: '750ml', wine_type: 'red', country: 'France',
    })
    expect(blason.description).toContain('low stock')
  })

  it('ignores a range label printed between two products', () => {
    // Casas Patronales prints "Reserva" and "Grand Reserva" on their own lines
    // to head a run of rows. They are neither a product nor a Type cell, so
    // they must not become a nameless product that takes part in the centring.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = parseCatalogXml(pageXml('CASAS PATRONALES'))
    const said = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('no Type cell ever arrived'))
    warn.mockRestore()

    expect(said).toEqual([])
    expect(items.filter(i => /^(Reserva|Grand Reserva)$/.test(i.name))).toEqual([])
    expect(shapeOf(items, "Casas Patronales 'Reserva' Cabernet Sauvignon"))
      .toEqual(['750ml/2023/910', '750ml/2024/910'])
    expect(shapeOf(items, "Casas Patronales 'Gran Reserva' Carmenere"))
      .toEqual(['750ml/2022/1075', '750ml/2023/1075'])
    expect(shapeOf(items, 'Casas Patronales Cabernet Sauvignon'))
      .toEqual(['750ml/2022/620', '750ml/2025/-'])
  })
})

describe('a run of wrapped names, one after another', () => {
  it('closes a wrapped name after its second half instead of swallowing the next', () => {
    // Buisson prints three wrapped names in a row. A product whose name is
    // wrapped around its code line has exactly two halves; keep absorbing and
    // the next product's name joins this one and its own row loses its code.
    const items = parseCatalogXml(pageXml('DOMAINE HENRI & GILLES BUISSON'))
    expect(shapeOf(items, "Domaine Henri & Gilles Buisson, Saint-Romain 'Sous La Velle'"))
      .toEqual(['750ml/2022/2990', '750ml/2023/2990'])
    expect(shapeOf(items, "Domaine Henri & Gilles Buisson, Saint-Romain 'Sous Roche'"))
      .toEqual(['750ml/2022/2795'])
    expect(shapeOf(items, "Domaine Henri & Gilles Buisson, Meursault 'Les Vignes de Marguerite'"))
      .toEqual(['750ml/2023/5330'])
    expect(items.filter(i => i.name.includes('Saint-Romain') && i.name.includes('Sous'))
      .map(i => i.name).filter((v, idx, a) => a.indexOf(v) === idx)).toHaveLength(2)
  })

  it('reads a name row that carries nothing but an Alc% as a name, not as prose', () => {
    // "Domaine J.A. Ferret, Pouilly-Fuisse,   13.0   2018" — readRow hands back
    // the Alc% along with the name, which used to push the text past the Size
    // column and make the row look like a producer paragraph. The name was then
    // thrown away and the priced row below it dropped for having none.
    const items = parseCatalogXml(pageXml('DOMAINE J.A. FERRET'))
    expect(shapeOf(items, "Domaine J.A. Ferret, Pouilly-Fuisse, Tete de Cru 'Clos des Prouges'"))
      .toEqual(['750ml/2017/2900', '750ml/2018/2900', '750ml/2019/2900', '750ml/2020/2900'])
    expect(items.filter(i => i.price === 3880 || i.price === 3180).length).toBeGreaterThan(0)
    for (const i of items) expect(i.name, i.name).not.toMatch(/\b(is|are|the|and|with)\b/)
  })
})

describe('a price serves the vintages printed beside it', () => {
  it('keeps a four-vintage, two-price cluster whole and pairs it by line', () => {
    // Domaine J.A. Ferret 'Tournant De Pouilly' prints 2018 / 2019-3,630 /
    // 2020-3,880 / 2021. Counting columns alone makes four vintages against two
    // prices look like a bad split, so the 2018 row was handed to the producer
    // above; and pairing the lists by index put 2019 on the 3,880 instead of on
    // the 3,630 printed on its own line.
    const items = parseCatalogXml(pageXml('DOMAINE J.A. FERRET'))
    expect(shapeOf(items, "Domaine J.A. Ferret, Pouilly-Fuisse, Cuvee Hors Classe 'Tournant De Pouilly'"))
      .toEqual(['750ml/2018/3630', '750ml/2019/3630', '750ml/2020/3880', '750ml/2021/3880'])
    expect(shapeOf(items, "Domaine J.A. Ferret, Pouilly-Fuisse, Cuvee Hors Classe 'Les Menetrieres"))
      .toEqual(['750ml/2017/3180', '750ml/2019/3880', '750ml/2020/3880'])
  })

  it('still pairs a cluster whose vintages and prices alternate line by line', () => {
    const items = parseCatalogXml(pageXml('DOMAINE COMTESSE DE CHERISEY'))
    expect(shapeOf(items, "Comtesse de Cherisey, Puligny-Montrachet, 1er Cru 'Hameau de Blagny'"))
      .toEqual(['750ml/2018/7750', '750ml/2019/8100', '750ml/2020/11000', '750ml/2021/11000'])
  })
})

describe('the one Tesseron table, which prints both oddities at once', () => {
  // The real Tesseron table, read off its own coordinates.
  function tesseronRows() {
    const rows = liftStockRows(wordRows(coords('TESSERON'))).rows
    const header = rows.find(r => tableColumns(r) !== null && rowText(r).includes('TESSERON'))!
    const columns = tableColumns(header)!
    return rows.filter(r => r.y > header.y).map(r => rowCells(r, columns))
  }

  it('reads a size written with a thousands separator', () => {
    // The catalog's only comma inside a size cell. Refused, the "1," leaks into
    // the product name and the bottle lands with volume: null — so this one
    // 1500ml Cognac would never match the catalog's other 1500ml entries.
    const row = tesseronRows().find(r => r.left.includes('Extreme Rare'))!
    expect(row.size).toBe('1500ml')
    expect(row.left).toBe('Cognac Tesseron Extreme Rare Cognac Grand Champagne')
  })

  it('still reads the ordinary sizes around it', () => {
    const sizes = tesseronRows().filter(r => r.size).map(r => r.size)
    expect(sizes.filter(v => v === '1500ml')).toHaveLength(1)
    expect(sizes.slice(0, 8)).toEqual(Array(8).fill('700ml'))
  })

  it('treats "Request for Quote" as a price the catalog has not set', () => {
    const items = parseCatalogXml(pageXml('TESSERON COGNAC'))

    const extreme = one(items, 'Tesseron Extreme Rare')
    expect(extreme).toMatchObject({
      name: 'Tesseron Extreme Rare Cognac Grand Champagne',
      volume: '1500ml', price: null,
      category: 'spirits', spirit_type: 'cognac', country: 'France',
    })

    const privee = one(items, 'Collection Privee')
    expect(privee).toMatchObject({ volume: '700ml', price: null })
    for (const i of [extreme, privee]) {
      expect(i.description, i.name).not.toMatch(/Quote/i)
      expect(i.description, i.name).toContain('Tesseron Cognac is a family-owned')
    }

    // The rest of the table is priced as printed.
    expect(one(items, "'Composition'").price).toBe(3650)
    expect(one(items, "'Experience 01'").price).toBe(79500)
  })
})

// ─── Word coordinates ──────────────────────────────────────────────────────

describe('bboxPages', () => {
  it('reads every page of the fixture', () => {
    expect(BBOX_PAGES).toHaveLength(22)
    expect(BBOX_PAGES.every(p => p.length > 50)).toBe(true)
  })

  it('decodes the XML escapes pdftotext writes', () => {
    const words = coords('HERMANDAD').map(w => w.text)
    expect(words).toContain('Hermandad,')
    const apostrophes = BBOX_PAGES.flat().filter(w => w.text.includes("'"))
    expect(apostrophes.length).toBeGreaterThan(50)
    expect(BBOX_PAGES.flat().some(w => w.text.includes('&apos;'))).toBe(false)
    expect(BBOX_PAGES.flat().some(w => w.text.includes('&amp;'))).toBe(false)
  })
})

describe('wordRows', () => {
  it('keeps the baselines that -layout folds together', () => {
    // The Hermandad cluster, which is the whole reason for this layer.
    const rows = wordRows(coords('HERMANDAD'))
      .filter(r => r.y > 545 && r.y < 585)
      .map(r => [Math.round(r.y * 10) / 10, rowText(r)] as const)
    expect(rows).toEqual([
      [549.0, '2019'],
      [553.0, 'R Hermandad, Blend (Malbec/ Cab/ Merlot/ Petit Verdot) 750ml 14.5 1,490'],
      [557.7, '2022'],
      [571.6, '2022'],
      [575.6, 'R Hermandad, Malbec 750ml 14.5 1,490'],
      [579.6, '2023'],
    ])
  })

  it('leaves a stock remark hanging under its row as a row of its own', () => {
    const rows = wordRows(coords("D'ESTOURNEL")).filter(r => r.y > 565 && r.y < 572)
    expect(rows.map(r => rowText(r))).toEqual([
      "R Chateau Cos d'Estournel Saint-Estephe 750ml 13 2021 9,440",
      'low stock',
    ])
    expect(Math.round((rows[1].y - rows[0].y) * 10) / 10).toBe(2.3)
  })
})

describe('liftStockRows', () => {
  it('takes the hangers out before anything measures a gap', () => {
    // Javelier-Laurin: four products, each with a stock remark hanging under it.
    // Left in, the gap from one hanger to the next product is 11.1pt and the two
    // products read as one cluster; lifted out, every gap is about 14.2pt.
    const rows = wordRows(coords('JAVELIER-LAURIN')).filter(r => r.y > 295 && r.y < 345)
    const { rows: kept, stock } = liftStockRows(rows)
    expect(rows).toHaveLength(8)
    expect(kept).toHaveLength(4)
    expect(kept.every(r => rowText(r).startsWith('R Javelier-Laurin,'))).toBe(true)
    expect(stock).toEqual([['out of stock'], ['low stock'], ['low stock'], ['out of stock']])

    const gaps = kept.slice(1).map((r, i) => Math.round(r.y - kept[i].y))
    expect(gaps).toEqual([14, 14, 14])
  })

  it('gives a hanger to the nearest row, not always the one above', () => {
    // Page 13's "low stock" sits 0.9pt above the Gin it belongs to and 13.3pt
    // below the Bourbon before it.
    const rows = wordRows(coords('Kentucky,')).filter(r => r.y > 650 && r.y < 670)
    const { rows: kept, stock } = liftStockRows(rows)
    expect(kept.map(r => rowText(r).slice(0, 26)))
      .toEqual(['Whisky Navigator, Kentucky', 'Gin Navigator, London Dry '])
    expect(stock).toEqual([[], ['low stock']])
  })
})

// ─── What the coordinates settle that the text layer could not ─────────────

describe('clusters come from the gaps between baselines', () => {
  it('keeps Hermandad’s lone 2022 with the product it was printed against', () => {
    // The case the text layer cannot express. Page 14 prints
    //   2019 / Blend … 750ml 14.5 1,490 / 2022   then, 13.9pt lower,
    //   2022 / Malbec … 750ml 14.5 1,490 / 2023
    // and -layout folds 2019 onto Blend's line and the second 2022 onto Malbec's,
    // leaving the first 2022 equidistant between two products that each already
    // carry a size, a vintage and a price. The old reader gave it to Malbec,
    // where it became a duplicate vintage and the dedup swallowed it: one real
    // position, silently absent from the import.
    const items = parseCatalogXml(pageXml('HERMANDAD'))
    expect(shapeOf(items, 'Hermandad, Blend (Malbec/ Cab/ Merlot/ Petit Verdot)'))
      .toEqual(['750ml/2019/1490', '750ml/2022/1490'])
    expect(shapeOf(items, 'Hermandad, Malbec'))
      .toEqual(['750ml/2022/1490', '750ml/2023/1490'])
  })

  it('breaks a cluster at the catalog’s narrowest product gap', () => {
    // Prototype, page 56: 13.1pt and 13.2pt between products, against 4.7pt
    // inside each cluster. The threshold has to fall between those.
    const items = parseCatalogXml(pageXml('PROTOTYPE'))
    expect(shapeOf(items, 'Prototype, Chardonnay')).toEqual(['750ml/2022/1110', '750ml/2024/1110'])
    expect(shapeOf(items, 'Prototype, Cabernet Sauvignon')).toEqual(['750ml/2022/1110', '750ml/2024/1110'])
    expect(shapeOf(items, 'Prototype, Zinfandel')).toEqual(['750ml/2021/1110', '750ml/2022/1110'])
  })

  it('reads a region banner whose words straddle the cell columns', () => {
    // RUPPERTSBERG, DEIDESHEIM, FORST prints its three words at 85, 207 and
    // 307pt, so two of them fall in the cell area. Reading only the left-hand
    // part truncates the region to "Ruppertsberg, Deidesheim,".
    const items = parseCatalogXml(pageXml('RUPPERTSBERG,'))
    expect([...new Set(items.map(i => i.region))]).toContain('Ruppertsberg, Deidesheim, Forst')
  })

  it('keeps a critic score out of the price column', () => {
    // The old reader searched a window of characters either side of the Price
    // anchor and had to be clamped by hand to stop a score 8 characters away
    // reading as the price. A word's own xMin settles it with nothing to tune.
    const items = parseCatalogXml(pageXml('PAUL BARA'))
    expect(one(items, "'Special Club Brut'").price).toBe(4945)
    expect(one(items, "'Special Club Brut'").description).toContain('94 VN')
    const reserve = one(items, "'Reserve Brut'")
    expect(reserve.price).toBe(3040)
    expect(reserve.description).toContain('91 WS')
    expect(reserve.description).toContain('90 VN')
  })
})

describe('what the parser refuses, and says it refuses', () => {
  it('refuses a cluster with a type and a name but not one cell', () => {
    // Emitted, it became a row of nulls in the database.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = parseCatalogXml(`<page width="595" height="842">
      <word xMin="40" yMin="100" xMax="60" yMax="110">Type</word>
      <word xMin="320" yMin="100" xMax="340" yMax="110">Size</word>
      <word xMin="370" yMin="100" xMax="390" yMax="110">Alc%</word>
      <word xMin="470" yMin="100" xMax="490" yMax="110">Price</word>
      <word xMin="520" yMin="100" xMax="545" yMax="110">Remark</word>
      <word xMin="42" yMin="130" xMax="48" yMax="140">R</word>
      <word xMin="62" yMin="130" xMax="140" yMax="140">Chateau Nowhere</word>
    </page>`)
    const said = warn.mock.calls.map(c => String(c[0]))
    warn.mockRestore()
    expect(items).toEqual([])
    expect(said.filter(m => m.includes('no size, vintage or price'))).toHaveLength(1)
  })

  it('leaves the country empty when a category page names one it does not know', () => {
    // A SPIRITS page for Peru would otherwise inherit the previous page's
    // country and file Pisco as Sri Lankan.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = parseCatalogXml(`<page width="595" height="842">
      <word xMin="260" yMin="40" xMax="330" yMax="52">SPIRITS</word>
      <word xMin="86" yMin="80" xMax="140" yMax="92">ATACAMA</word>
      <word xMin="40" yMin="140" xMax="60" yMax="150">Type</word>
      <word xMin="320" yMin="140" xMax="340" yMax="150">Size</word>
      <word xMin="370" yMin="140" xMax="390" yMax="150">Alc%</word>
      <word xMin="470" yMin="140" xMax="490" yMax="150">Price</word>
      <word xMin="520" yMin="140" xMax="545" yMax="150">Remark</word>
      <word xMin="42" yMin="170" xMax="70" yMax="180">Brandy</word>
      <word xMin="80" yMin="170" xMax="200" yMax="180">Pisco Quebranta</word>
      <word xMin="320" yMin="170" xMax="345" yMax="180">700ml</word>
      <word xMin="470" yMin="170" xMax="495" yMax="180">1,200</word>
    </page>`)
    const said = warn.mock.calls.map(c => String(c[0]))
    warn.mockRestore()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'Pisco Quebranta', country: null, region: 'Atacama' })
    expect(said.filter(m => m.includes('names no country this parser knows'))).toHaveLength(1)
  })

  it('names Peru and the other spirits countries it does know', () => {
    const peru = parseCatalogXml(`<page width="595" height="842">
      <word xMin="260" yMin="40" xMax="330" yMax="52">SPIRITS</word>
      <word xMin="86" yMin="80" xMax="120" yMax="92">PERU</word>
      <word xMin="40" yMin="140" xMax="60" yMax="150">Type</word>
      <word xMin="320" yMin="140" xMax="340" yMax="150">Size</word>
      <word xMin="370" yMin="140" xMax="390" yMax="150">Alc%</word>
      <word xMin="470" yMin="140" xMax="490" yMax="150">Price</word>
      <word xMin="42" yMin="170" xMax="70" yMax="180">Brandy</word>
      <word xMin="80" yMin="170" xMax="200" yMax="180">Pisco Quebranta</word>
      <word xMin="320" yMin="170" xMax="345" yMax="180">700ml</word>
      <word xMin="470" yMin="170" xMax="495" yMax="180">1,200</word>
    </page>`)
    expect(peru[0]).toMatchObject({ country: 'Peru', region: null })
  })

  it('warns loudly when one price covers two different bottle sizes', () => {
    // Tolaini 'Al Passo' is the only one in the catalog, and it must not hide
    // among the 213 benign "one price, several vintages" clusters.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseCatalogXml(pageXml('TOLAINI'))
    const said = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('BOTTLE SIZES'))
    warn.mockRestore()
    expect(said).toHaveLength(1)
    expect(said[0]).toContain("Al Passo")
    expect(said[0]).toContain('750ml')
    expect(said[0]).toContain('1500ml')
  })

  it('reports every prose line it throws away inside a table', () => {
    // A wrapped product name mistaken for prose would go with its cells, which
    // is how a phantom priced wine gets filed under half a sentence.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const items = parseCatalogXml(pageXml('CLENDENEN'))
    const said = warn.mock.calls.map(c => String(c[0])).filter(m => m.includes('prose inside a table'))
    warn.mockRestore()
    expect(said.length).toBeGreaterThanOrEqual(3)
    expect(said.every(m => !m.includes('WITH CELLS'))).toBe(true)
    // ...and the product whose name comes closest in the catalog to its size
    // cell is still read, 4pt of clearance and all.
    expect(shapeOf(items, "Au Bon Climat 'Sanford & Benedict Vineyard' Santa Ynez Valley, Pinot Noir"))
      .toEqual(['750ml/2019/2760', '750ml/2021/2760'])
  })
})

// ─── Golden cell table, ported to coordinates ──────────────────────────────
//
// Every cell-bearing row of the five pages this table was first taken over, with
// the cells each one must yield. 62 of the 72 rows are byte-identical to the
// values that were read off the raw PDF by hand for the text-column reader; the
// ten that moved were each checked against the PDF again, and every one is the
// coordinate reader doing better:
//
//   - the name rows of the two multi-size Champagnes appear, carrying their NV
//     and no size or price, because a row is no longer required to have a size
//     or a price to exist;
//   - Jean-Yves de Carlini's "low stock" is no longer this row's Remark cell —
//     it is a hanging row, lifted out and carried as the product's stock state
//     (the description still says it, which the item tests pin);
//   - Chateau La Pensee, the four Javelier-Laurins and Philippe Leclerc now
//     carry their own type code and a name free of the stock phrase. The text
//     reader lost the code on those rows, because -layout tore it onto a line of
//     its own, and left "out of stock" inside the name.
//
// This is a broad net under cell reading, independent of how rows are grouped
// into products. It is not a substitute for the targeted cases above.

type GoldenCells = {
  type: string; name: string; size: string; vintage: string; price: string; remark: string
}

const GOLDEN: GoldenCells[] = [
  { type: "", name: "", size: "750ml", vintage: "", price: "2710", remark: "" },
  { type: "wine/sparkling", name: "Canard Duchene Champagne 'Cuvee Leonie' Brut", size: "", vintage: "NV", price: "", remark: "" },
  { type: "", name: "", size: "1500ml", vintage: "", price: "5520", remark: "" },
  { type: "wine/sparkling", name: "Canard-Duchene Champagne Brut", size: "750ml", vintage: "2015", price: "2900", remark: "" },
  { type: "wine/sparkling", name: "Canard Duchene Champagne Extra Brut 'P.181'", size: "750ml", vintage: "NV", price: "3460", remark: "88 WE" },
  { type: "wine/sparkling", name: "Canard Duchene Champagne 'Cuvee Leonie' Brut Rose", size: "750ml", vintage: "NV", price: "3000", remark: "" },
  { type: "", name: "", size: "375ml", vintage: "", price: "1440", remark: "91 WS" },
  { type: "wine/sparkling", name: "Goutorbe-Bouillot Champagne 'Reflets De Riviere' Brut", size: "", vintage: "NV", price: "", remark: "" },
  { type: "", name: "", size: "750ml", vintage: "", price: "2010", remark: "90 JS" },
  { type: "wine/sparkling", name: "Goutorbe-Bouillot Champagne 'Le Ru Des Charmes' Rose Brut", size: "750ml", vintage: "NV", price: "2570", remark: "91 JS" },
  { type: "wine/sparkling", name: "Jean-Yves de Carlini Champagne 'Reserve' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2620", remark: "" },
  { type: "wine/sparkling", name: "Jean-Yves de Carlini Champagne 'Rose' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2670", remark: "" },
  { type: "wine/sparkling", name: "Pierre Moncuit Champagne 'Pierre Moncuit-Delos' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2700", remark: "" },
  { type: "wine/sparkling", name: "Pierre Moncuit Champagne 'Rose' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2880", remark: "" },
  { type: "wine/sparkling", name: "Paul Bara Champagne, Grand Cru 'Reserve Brut'", size: "750ml", vintage: "NV", price: "3040", remark: "" },
  { type: "wine/sparkling", name: "Paul Bara Champagne, Grand Cru 'Grand Rose Brut'", size: "750ml", vintage: "NV", price: "3275", remark: "" },
  { type: "wine/sparkling", name: "Paul Bara Champagne, Grand Cru 'Grand Millesime Brut' Grand Cru", size: "750ml", vintage: "2014", price: "5550", remark: "" },
  { type: "wine/sparkling", name: "Paul Bara Champagne, Grand Crus 'Special Club Brut'", size: "750ml", vintage: "2016", price: "4945", remark: "94 VN" },
  { type: "spirits/rum", name: "Ron Barcelo Blanco Anejado", size: "700ml", vintage: "", price: "1300", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo 'Cream' Crema De Ron", size: "700ml", vintage: "", price: "1480", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Gran Anejo", size: "700ml", vintage: "", price: "1770", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Imperial", size: "700ml", vintage: "", price: "2700", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Imperial Onyx", size: "700ml", vintage: "", price: "2700", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Imperial Premium Blend 40 Aniversario", size: "700ml", vintage: "", price: "9250", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Organic", size: "700ml", vintage: "", price: "1700", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Imperial Mizunara Cask", size: "700ml", vintage: "", price: "3230", remark: "" },
  { type: "spirits/rum", name: "Ron Barcelo Imperial Maple Cask", size: "700ml", vintage: "", price: "2750", remark: "" },
  { type: "spirits/rum", name: "Barcelo Imperial Porto Cask", size: "700ml", vintage: "", price: "2750", remark: "" },
  { type: "spirits/gin", name: "Gelas 'Gin Gelas'", size: "700ml", vintage: "", price: "2625", remark: "" },
  { type: "spirits/liqueur", name: "Gelas 'Liqueur Cordialor'", size: "700ml", vintage: "", price: "2875", remark: "" },
  { type: "spirits/rum", name: "Gelas Rhum 'Double Matured' Panama Old Rum 10 Years Old", size: "700ml", vintage: "", price: "3750", remark: "" },
  { type: "spirits/eau-de-vie", name: "Gelas, Eau De Vie 'Double Matured' Vielle Prune", size: "700ml", vintage: "", price: "3750", remark: "" },
  { type: "spirits/eau-de-vie", name: "Gelas, Vielle Eau De Vie De Prune", size: "700ml", vintage: "", price: "3060", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 12 Ans 'Single Cask' Double Matured", size: "700ml", vintage: "", price: "5500", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 8 Ans", size: "700ml", vintage: "", price: "3125", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 18 Ans", size: "700ml", vintage: "", price: "4375", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 30 Ans", size: "700ml", vintage: "", price: "7240", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 40 Ans", size: "700ml", vintage: "", price: "9420", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 50 Ans", size: "700ml", vintage: "", price: "17280", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac 60 Ans", size: "700ml", vintage: "", price: "41960", remark: "" },
  { type: "spirits/armagnac", name: "Gelas, Bas Armagnac Michel Firino Martell 1982", size: "700ml", vintage: "", price: "13500", remark: "" },
  { type: "spirits/aperitif", name: "30&40 Double Jus (Aperitive de Normandie)", size: "700ml", vintage: "", price: "2760", remark: "" },
  { type: "spirits/rum", name: "Arhumatic Punch Au Rhum", size: "700ml", vintage: "", price: "3170", remark: "" },
  { type: "spirits/rum", name: "Arhumatic Punch Au Rhum 'Raisin'", size: "700ml", vintage: "", price: "2990", remark: "" },
  { type: "spirits/rum", name: "Arhumatic Punch Au Rhum 'Rubus Idaeus'", size: "700ml", vintage: "", price: "3130", remark: "" },
  { type: "wine/red", name: "Chateau Limbourg AOC", size: "750ml", vintage: "2016", price: "1825", remark: "" },
  { type: "wine/red", name: "La Pommeraie de Brown Pessac Leognan Rouge", size: "750ml", vintage: "2017", price: "2010", remark: "" },
  { type: "wine/red", name: "Chateau Trigant Pessac-Leognan", size: "750ml", vintage: "2016", price: "2140", remark: "" },
  { type: "wine/red", name: "Chateau Haut-Vigneau, Pessac-Leognan", size: "750ml", vintage: "2019", price: "1570", remark: "" },
  { type: "wine/red", name: "Chateau Herve-Laroque, Fronsac Bordeaux", size: "750ml", vintage: "2018", price: "1590", remark: "" },
  { type: "wine/red", name: "Chateau La Pensee Lalande de Pomerol", size: "750ml", vintage: "2020", price: "1450", remark: "" },
  { type: "wine/red", name: "Chateau La Loubiere, Bordeaux Superiur", size: "750ml", vintage: "2020", price: "1100", remark: "" },
  { type: "wine/white", name: "Chateau Haut Pougnan Sauvignon Bordeaux", size: "750ml", vintage: "2021", price: "1170", remark: "" },
  { type: "wine/red", name: "Chateau Haut Pougnan Bordeaux", size: "750ml", vintage: "2020", price: "1170", remark: "" },
  { type: "wine/red", name: "Domaine Philippe Cheron, Chambolle-Musigny Les Quarante Ouvrees", size: "750ml", vintage: "2018", price: "4160", remark: "" },
  { type: "wine/red", name: "Domaine Philippe Cheron, Gevrey-Chambertin 'La Rue Des Mees'", size: "750ml", vintage: "2018", price: "4160", remark: "" },
  { type: "wine/red", name: "Domaine Philippe Cheron, Vosne-Romanee Les Barreaux", size: "750ml", vintage: "2017", price: "4440", remark: "" },
  { type: "wine/red", name: "Javelier-Laurin, Bourgogne Pinot Noir", size: "750ml", vintage: "2020", price: "1500", remark: "" },
  { type: "wine/red", name: "Javelier-Laurin, Gevrey-Chambertin 'Les Champs Chenys'", size: "750ml", vintage: "2019", price: "4490", remark: "" },
  { type: "wine/red", name: "Javelier-Laurin, Gevrey-Chambertin 1er Cru 'Bel Air'", size: "750ml", vintage: "2020", price: "5900", remark: "" },
  { type: "wine/red", name: "Javelier-Laurin, Ruchottes-Chambertin Grand Cru", size: "750ml", vintage: "2017", price: "12150", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Marsannay Blanc 'Les Champs Perdrix'", size: "750ml", vintage: "2020", price: "3125", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Bourgogne Pinot Noir", size: "750ml", vintage: "2020", price: "2475", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 'Cuvee Alexis'", size: "750ml", vintage: "2018", price: "4490", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 'Les Crais'", size: "750ml", vintage: "2019", price: "4000", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 1er Cru 'La Petite Chapelle'", size: "750ml", vintage: "2020", price: "8405", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 1er Cru 'Les Chapeaux'", size: "750ml", vintage: "2019", price: "6540", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Marsannay Les Quenicieres", size: "750ml", vintage: "2019", price: "3420", remark: "" },
  { type: "wine/red", name: "Jean-Michel Guillon & Fils, Morey Saint Denis 1er Cru 'La Riotte'", size: "750ml", vintage: "2020", price: "7000", remark: "" },
  { type: "wine/red", name: "Philippe Leclerc, Bourgogne 'Les Bons Batons'", size: "750ml", vintage: "2019", price: "2320", remark: "" },
  { type: "wine/red", name: "Philippe Leclerc, Chambolle-Musigny 'Les Babillaires'", size: "750ml", vintage: "2019", price: "4200", remark: "" },
  { type: "wine/red", name: "Philippe Leclerc, Gevrey-Chambertin 1er Cru 'Les Champeaux'", size: "750ml", vintage: "2019", price: "4670", remark: "" },]

describe('golden cell table over the five original pages', () => {
  // Walked exactly as the parser walks: stock rows lifted, headers consumed,
  // glassware tables refused.
  const actual: GoldenCells[] = []
  for (const marker of ['ZALTO', 'CANARD-DUCHÊNE', 'GELAS', 'LIMBOURG', 'JAVELIER-LAURIN']) {
    let columns: ReturnType<typeof tableColumns> = null
    for (const row of liftStockRows(wordRows(coords(marker))).rows) {
      if (row.words[0].text === 'Type' || row.words[0].text === 'CODE') { columns = tableColumns(row); continue }
      if (!columns) continue
      const c = rowCells(row, columns)
      if (!c.size && !c.vintage && c.price.kind === 'none') continue
      const matched = matchType(splitStockPrefix(c.left).rest)
      actual.push({
        type: matched ? `${matched.type.category}/${matched.type.wineType ?? matched.type.spiritType ?? '-'}` : '',
        name: matched ? matched.rest : splitStockPrefix(c.left).rest,
        size: c.size,
        vintage: c.vintage,
        price: c.price.kind === 'num' ? String(c.price.value) : c.price.kind === 'pending' ? 'pending' : '',
        remark: c.remark,
      })
    }
  }

  it('reads every cell of every row exactly', () => {
    expect(actual).toEqual(GOLDEN)
  })

  it('yields no row at all from the glassware page', () => {
    let columns: ReturnType<typeof tableColumns> = null
    let read = 0
    for (const row of liftStockRows(wordRows(coords('ZALTO'))).rows) {
      if (row.words[0].text === 'Type' || row.words[0].text === 'CODE') { columns = tableColumns(row); continue }
      if (columns) read++
    }
    expect(read).toBe(0)
  })

  it('never leaves a price that is not a well-formed number', () => {
    for (const row of actual) {
      if (!row.price || row.price === 'pending') continue
      expect(toIntPrice(row.price), row.name).not.toBeNull()
      expect(toIntPrice(row.price)!).toBeGreaterThan(100)
    }
  })
})

describe('tableColumns refuses what is not a beverage table', () => {
  function header(...labels: [string, number][]): ReturnType<typeof tableColumns> {
    return tableColumns({ y: 0, words: labels.map(([text, x]) => ({ x, y: 0, text })) })
  }

  it('requires Alc% — the one column every beverage table has and no accessory table does', () => {
    expect(header(['Type', 40], ['Size', 320], ['Vintage', 410], ['Price', 470])).toBeNull()
    expect(header(['Type', 40], ['Size', 320], ['Alc%', 370], ['Price', 470])).not.toBeNull()
  })

  it('does not take the Price anchor out of the middle of Price/Pcs', () => {
    // The glassware headers, as pdftotext gives them: each label is one word, so
    // Price/Pcs and Height/Volume simply are not Price and Size.
    expect(header(['Type', 40], ['Size', 320], ['Packing', 400], ['Price/Pcs', 470])).toBeNull()
    expect(header(['CODE', 40], ['Height/Volume', 320], ['Packing', 420], ['Price/Pcs', 480])).toBeNull()
  })

  it('refuses a row that is not a header at all', () => {
    expect(header(['CHAMPAGNE', 200])).toBeNull()
    expect(header(['R', 42], ['Size', 320], ['Alc%', 370], ['Price', 470])).toBeNull()
  })
})

describe('a word is a whole token, so no number can be half-read', () => {
  it('never reads a price out of an ABV figure', () => {
    // Ron Barceló really prints 37.50 and 38.00 in its Alc% column, and the old
    // character-window reader had to be bounded by hand to stop "50" becoming
    // the price of a rum.
    const items = parseCatalogXml(pageXml('BARCELÓ'))
    expect(one(items, 'Ron Barcelo Blanco Anejado').price).toBe(1300)
    expect(items.every(i => i.price === null || i.price > 100)).toBe(true)
  })

  it('never reads a price out of the middle of a longer number', () => {
    const items = parseCatalogXml(pageXml('GELAS'))
    expect(one(items, 'Bas Armagnac 50 Ans').price).toBe(17280)
    expect(one(items, 'Bas Armagnac 60 Ans').price).toBe(41960)
  })
})
