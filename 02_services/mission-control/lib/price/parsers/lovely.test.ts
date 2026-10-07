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

import { columnAnchors, readRow } from './lovely'

const CANARD_HDR =
  ' Type                       CANARD-DUCHÊNE                                   Size           Alc%          Vintage          Price     Remark'
const GELAS_HDR =
  '  Type                                     MAISON GELAS                                      Size         Alc%         Price          Remark'
const GLASS_HDR =
  '   Type                                    CIGAR ASHTRAY            Size         Packing    Price/Pcs'

describe('columnAnchors', () => {
  it('reads every column of a wine table', () => {
    const a = columnAnchors(CANARD_HDR)
    expect(a).not.toBeNull()
    expect(a!.size).toBe(CANARD_HDR.indexOf('Size'))
    expect(a!.vintage).toBe(CANARD_HDR.indexOf('Vintage'))
    expect(a!.price).toBe(CANARD_HDR.indexOf('Price'))
  })

  it('accepts a spirits table with no Vintage column', () => {
    const a = columnAnchors(GELAS_HDR)
    expect(a!.vintage).toBeNull()
    expect(a!.price).toBe(GELAS_HDR.indexOf('Price'))
  })

  it('rejects glassware tables', () => {
    expect(columnAnchors(GLASS_HDR)).toBeNull()
  })

  it('rejects anything that is not a table header', () => {
    expect(columnAnchors('             CHAMPAGNE')).toBeNull()
    expect(columnAnchors('')).toBeNull()
  })
})

describe('readRow', () => {
  const a = columnAnchors(CANARD_HDR)!

  it('reads a complete row', () => {
    const row = readRow(' CP     Canard-Duchene Champagne Brut                                      750ml            12.0           2015            2,900', a)
    expect(row).toEqual({
      left: 'CP     Canard-Duchene Champagne Brut',
      size: '750ml',
      vintage: '2015',
      price: '2,900',
      remark: '',
    })
  })

  it('reads a variant row whose size prints left of the Size label', () => {
    const row = readRow('                                                                           1500ml                                          5,520', a)
    expect(row.left).toBe('')
    expect(row.size).toBe('1500ml')
    expect(row.price).toBe('5,520')
  })

  it('does not let the size bleed into the product name', () => {
    const row = readRow('                                                                            750ml                                          2,710', a)
    expect(row.left).toBe('')
    expect(row.size).toBe('750ml')
  })

  it('keeps NV out of the year and reads the remark', () => {
    const row = readRow(" CP     Canard Duchene Champagne Extra Brut 'P.181'                        750ml            12.0            NV             3,460     88 WE", a)
    expect(row.vintage).toBe('NV')
    expect(row.price).toBe('3,460')
    expect(row.remark).toBe('88 WE')
  })

  it('reads a row whose name is preceded by a stock remark', () => {
    const b = columnAnchors('  Type                                      JAVELIER-LAURIN                                       Size       Alc%         Vintage     Price   Remark')!
    const row = readRow('out of stock    Javelier-Laurin, Bourgogne Pinot Noir                                            750ml       13.0         2020       1,500', b)
    expect(row.left).toBe('out of stock    Javelier-Laurin, Bourgogne Pinot Noir')
    expect(row.price).toBe('1,500')
  })
})

// ─── Review fixes ──────────────────────────────────────────────────────────

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
const MUGA_HDR =
  '   Type                               MUGA                                  Size         Alc%        Vintage         Price        Remark'
const MUGA_DOT_ROW =
  '                                                                           375ml                      2021           1.020'

describe('cell token boundaries', () => {
  it('refuses a price whose thousands separator is a dot rather than truncating it', () => {
    // Without a left boundary the old regex matched the "020" of "1.020" and the
    // row went into the database at THB 20 instead of 1,020.
    const row = readRow(MUGA_DOT_ROW, columnAnchors(MUGA_HDR)!)
    expect(row.price).toBe('')
    expect(row.size).toBe('375ml')
    expect(row.vintage).toBe('2021')
  })

  it('never reads a price out of the middle of a longer number', () => {
    const a = columnAnchors(CANARD_HDR)!
    const line = ' CP     Something                                                          750ml            12.0           2015          102000'
    expect(readRow(line, a).price).not.toBe('02000')
  })

  it('never reads a price out of an ABV figure', () => {
    // Ron Barceló really prints 37.50 and 38.00 in the Alc% column.
    const a = columnAnchors(GELAS_HDR)!
    const alcOnly = '  Rum        Ron Barcelo Blanco Anejado                                                       700ml         37.50'
    expect(readRow(alcOnly, a).price).toBe('')
  })

  it('never reads a size out of the middle of a longer number', () => {
    const a = columnAnchors(CANARD_HDR)!
    const line = '                                                                          12000ml                                         2,710'
    expect(readRow(line, a).size).not.toBe('2000ml')
  })
})

// Real Javelier-Laurin header, fixture page 31. Its Remark column sits exactly 8
// characters right of Price — within the old flat window of 8.
const JAVELIER_HDR =
  '  Type                                      JAVELIER-LAURIN                                       Size       Alc%         Vintage     Price   Remark'

describe('per-table search window', () => {
  it('does not read a critic score printed at the Remark anchor as the price', () => {
    const a = columnAnchors(JAVELIER_HDR)!
    expect(a.remark! - a.price).toBe(8)       // the geometry that broke the flat window
    const scoreOnly = ' '.repeat(a.remark!) + '91 WS'
    expect(readRow(scoreOnly, a).price).toBe('')
  })

  it('still reads every real price in the tightest tables', () => {
    const a = columnAnchors(JAVELIER_HDR)!
    const row = readRow('out of stock    Javelier-Laurin, Bourgogne Pinot Noir                                            750ml       13.0         2020       1,500', a)
    expect(row.price).toBe('1,500')
    expect(row.vintage).toBe('2020')
    expect(row.size).toBe('750ml')
  })

  it('keeps the full 8 characters where the neighbouring column is far away', () => {
    // Size cells print as much as 8 characters left of their label and Size has no
    // column to its left, so that leeway must survive the clamp.
    const a = columnAnchors(CANARD_HDR)!
    const line = ' '.repeat(a.size - 8) + '1500ml' + ' '.repeat(a.price - (a.size - 8) - 6) + '5,520'
    expect(readRow(line, a).size).toBe('1500ml')
  })

  it('picks the candidate nearest the anchor when two sit inside the window', () => {
    const a = columnAnchors(CANARD_HDR)!
    // '1,111' starts 3 left of the Price anchor, '2,222' starts 2 right of it.
    const line = ' '.repeat(a.price - 3) + '1,111 2,222'
    expect(line.indexOf('2,222') - a.price).toBe(3)
    expect(readRow(line, a).price).toBe('1,111')
    // ...and mirrored, so the test cannot pass by preferring the left-most match.
    const line2 = ' '.repeat(a.price - 7) + '1,111' + ' '.repeat(5) + '2,222'
    expect(a.price - line2.indexOf('1,111')).toBe(7)
    expect(line2.indexOf('2,222') - a.price).toBe(3)
    expect(readRow(line2, a).price).toBe('2,222')
  })
})

// Builds a header with its labels at exact columns, so a test can state the
// geometry it is probing instead of hiding it in a wall of spaces.
function headerAt(cols: Record<string, number>): string {
  let s = ' Type'
  for (const [label, col] of Object.entries(cols).sort((a, b) => a[1] - b[1])) {
    s = s.padEnd(col, ' ') + label
  }
  return s
}

describe('a vintage is never a price', () => {
  // 10 characters is the tightest Vintage->Price gap in the catalog, and vintages
  // print as much as 5 characters right of their anchor — so a name row carrying
  // only a vintage can put a year inside the price window.
  const TIGHT_HDR = headerAt({ Size: 80, 'Alc%': 95, Vintage: 110, Price: 120, Remark: 134 })

  it('is set up on the tightest geometry the catalog contains', () => {
    const a = columnAnchors(TIGHT_HDR)!
    expect(a.vintage).toBe(110)
    expect(a.price).toBe(120)
  })

  it('leaves the price empty on a priceless name row carrying a vintage', () => {
    const a = columnAnchors(TIGHT_HDR)!
    const withYear = ('R    Some Wine'.padEnd(80, ' ') + '750ml').padEnd(115, ' ') + '2020'
    expect(withYear.indexOf('2020')).toBe(115)   // +5 from Vintage, 5 from Price
    const row = readRow(withYear, a)
    expect(row.vintage).toBe('2020')
    expect(row.price).toBe('')
  })

  it('still reads a real price that sits beside a vintage', () => {
    const a = columnAnchors(TIGHT_HDR)!
    const full = ('R    Some Wine'.padEnd(80, ' ') + '750ml').padEnd(111, ' ') + '2020' + ' '.repeat(5) + '1,500'
    const row = readRow(full, a)
    expect(row.vintage).toBe('2020')
    expect(row.price).toBe('1,500')
  })
})

// Aliased so the plain `readFileSync` / `join` names stay free for later tasks.
import { readFileSync as readFixture } from 'fs'
import { join as joinPath } from 'path'

describe('columnAnchors — positive beverage gate', () => {
  it('refuses a reworded accessory header the blocklist would have missed', () => {
    // The old blocklist looked for the literals Packing / Price/Pcs /
    // Height/Volume. Reword any of them and glassware walks straight in.
    expect(columnAnchors('   Type       CIGAR ASHTRAY       Size       Pack      Price/pc')).toBeNull()
    expect(columnAnchors('   Type       ZALTO GLASS         Size       Qty       Unit Price')).toBeNull()
  })

  it('requires Alc% — the one column every beverage table has and no accessory table does', () => {
    expect(columnAnchors('  Type      SOMETHING      Size        Vintage      Price     Remark')).toBeNull()
    expect(columnAnchors('  Type      SOMETHING      Size        Alc%         Price     Remark')).not.toBeNull()
  })

  it('does not take the Price anchor out of the middle of Price/Pcs', () => {
    // 'CIGAR ASHTRAY' prints Size and Price/Pcs; indexOf('Price') happily found
    // the Price inside Price/Pcs and handed back a bogus anchor.
    const a = columnAnchors('   Type    CIGAR ASHTRAY    Size    Alc%    Packing    Price/Pcs')
    expect(a).toBeNull()
  })

  it('still accepts every beverage header in the fixture', () => {
    // Scoped to the five pages this census was taken over. Task 5 appended six
    // more pages to the same fixture; the counts below are a census, not a
    // contract about how many pages the file holds.
    const fixture = readFixture(joinPath(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
      .split('\f').slice(0, 5).join('\f')
    const headers = fixture.split('\n').filter(l => /^\s*(Type|CODE)\s{2,}/.test(l))
    expect(headers).toHaveLength(24)
    const accepted = headers.filter(h => columnAnchors(h) !== null)
    expect(accepted).toHaveLength(20)   // 24 tables less the 4 accessory ones
  })
})

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

type GoldenRow = {
  line: number; type: string; name: string
  size: string; vintage: string; price: string; remark: string
}

const GOLDEN: GoldenRow[] = [
  { line:  66, type: ""                  , name: "", size: "750ml", vintage: "", price: "2,710", remark: "" },
  { line:  68, type: ""                  , name: "", size: "1500ml", vintage: "", price: "5,520", remark: "" },
  { line:  69, type: "wine/sparkling"    , name: "Canard-Duchene Champagne Brut", size: "750ml", vintage: "2015", price: "2,900", remark: "" },
  { line:  70, type: "wine/sparkling"    , name: "Canard Duchene Champagne Extra Brut 'P.181'", size: "750ml", vintage: "NV", price: "3,460", remark: "88 WE" },
  { line:  71, type: "wine/sparkling"    , name: "Canard Duchene Champagne 'Cuvee Leonie' Brut Rose", size: "750ml", vintage: "NV", price: "3,000", remark: "" },
  { line:  82, type: ""                  , name: "", size: "375ml", vintage: "", price: "1,440", remark: "91 WS" },
  { line:  84, type: ""                  , name: "", size: "750ml", vintage: "", price: "2,010", remark: "90 JS" },
  { line:  85, type: "wine/sparkling"    , name: "Goutorbe-Bouillot Champagne 'Le Ru Des Charmes' Rose Brut", size: "750ml", vintage: "NV", price: "2,570", remark: "91 JS" },
  { line:  96, type: "wine/sparkling"    , name: "Jean-Yves de Carlini Champagne 'Reserve' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2,620", remark: "low stock" },
  { line:  99, type: "wine/sparkling"    , name: "Jean-Yves de Carlini Champagne 'Rose' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2,670", remark: "low stock" },
  { line: 111, type: "wine/sparkling"    , name: "Pierre Moncuit Champagne 'Pierre Moncuit-Delos' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2,700", remark: "" },
  { line: 112, type: "wine/sparkling"    , name: "Pierre Moncuit Champagne 'Rose' Grand Cru Brut", size: "750ml", vintage: "NV", price: "2,880", remark: "" },
  { line: 123, type: "wine/sparkling"    , name: "Paul Bara Champagne, Grand Cru 'Reserve Brut'", size: "750ml", vintage: "NV", price: "3,040", remark: "" },
  { line: 125, type: "wine/sparkling"    , name: "Paul Bara Champagne, Grand Cru 'Grand Rose Brut'", size: "750ml", vintage: "NV", price: "3,275", remark: "" },
  { line: 126, type: "wine/sparkling"    , name: "Paul Bara Champagne, Grand Cru 'Grand Millesime Brut' Grand Cru", size: "750ml", vintage: "2014", price: "5,550", remark: "" },
  { line: 127, type: "wine/sparkling"    , name: "Paul Bara Champagne, Grand Crus 'Special Club Brut'", size: "750ml", vintage: "2016", price: "4,945", remark: "94 VN" },
  { line: 136, type: "spirits/rum"       , name: "Ron Barcelo Blanco Anejado", size: "700ml", vintage: "", price: "1,300", remark: "" },
  { line: 137, type: "spirits/rum"       , name: "Ron Barcelo 'Cream' Crema De Ron", size: "700ml", vintage: "", price: "1,480", remark: "" },
  { line: 138, type: "spirits/rum"       , name: "Ron Barcelo Gran Anejo", size: "700ml", vintage: "", price: "1,770", remark: "" },
  { line: 139, type: "spirits/rum"       , name: "Ron Barcelo Imperial", size: "700ml", vintage: "", price: "2,700", remark: "" },
  { line: 140, type: "spirits/rum"       , name: "Ron Barcelo Imperial Onyx", size: "700ml", vintage: "", price: "2,700", remark: "" },
  { line: 141, type: "spirits/rum"       , name: "Ron Barcelo Imperial Premium Blend 40 Aniversario", size: "700ml", vintage: "", price: "9,250", remark: "" },
  { line: 142, type: "spirits/rum"       , name: "Ron Barcelo Organic", size: "700ml", vintage: "", price: "1,700", remark: "" },
  { line: 143, type: "spirits/rum"       , name: "Ron Barcelo Imperial Mizunara Cask", size: "700ml", vintage: "", price: "3,230", remark: "" },
  { line: 144, type: "spirits/rum"       , name: "Ron Barcelo Imperial Maple Cask", size: "700ml", vintage: "", price: "2,750", remark: "" },
  { line: 145, type: "spirits/rum"       , name: "Barcelo Imperial Porto Cask", size: "700ml", vintage: "", price: "2,750", remark: "" },
  { line: 153, type: "spirits/gin"       , name: "Gelas 'Gin Gelas'", size: "700ml", vintage: "", price: "2,625", remark: "" },
  { line: 154, type: "spirits/liqueur"   , name: "Gelas 'Liqueur Cordialor'", size: "700ml", vintage: "", price: "2,875", remark: "" },
  { line: 155, type: "spirits/rum"       , name: "Gelas Rhum 'Double Matured' Panama Old Rum 10 Years Old", size: "700ml", vintage: "", price: "3,750", remark: "" },
  { line: 156, type: "spirits/eau-de-vie", name: "Gelas, Eau De Vie 'Double Matured' Vielle Prune", size: "700ml", vintage: "", price: "3,750", remark: "" },
  { line: 157, type: "spirits/eau-de-vie", name: "Gelas, Vielle Eau De Vie De Prune", size: "700ml", vintage: "", price: "3,060", remark: "" },
  { line: 158, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 12 Ans 'Single Cask' Double Matured", size: "700ml", vintage: "", price: "5,500", remark: "" },
  { line: 159, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 8 Ans", size: "700ml", vintage: "", price: "3,125", remark: "" },
  { line: 160, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 18 Ans", size: "700ml", vintage: "", price: "4,375", remark: "" },
  { line: 161, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 30 Ans", size: "700ml", vintage: "", price: "7,240", remark: "" },
  { line: 162, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 40 Ans", size: "700ml", vintage: "", price: "9,420", remark: "" },
  { line: 163, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 50 Ans", size: "700ml", vintage: "", price: "17,280", remark: "" },
  { line: 164, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac 60 Ans", size: "700ml", vintage: "", price: "41,960", remark: "" },
  { line: 165, type: "spirits/armagnac"  , name: "Gelas, Bas Armagnac Michel Firino Martell 1982", size: "700ml", vintage: "", price: "13,500", remark: "" },
  { line: 174, type: "spirits/aperitif"  , name: "30&40 Double Jus (Aperitive de Normandie)", size: "700ml", vintage: "", price: "2,760", remark: "" },
  { line: 184, type: "spirits/rum"       , name: "Arhumatic Punch Au Rhum", size: "700ml", vintage: "", price: "3,170", remark: "" },
  { line: 185, type: "spirits/rum"       , name: "Arhumatic Punch Au Rhum 'Raisin'", size: "700ml", vintage: "", price: "2,990", remark: "" },
  { line: 186, type: "spirits/rum"       , name: "Arhumatic Punch Au Rhum 'Rubus Idaeus'", size: "700ml", vintage: "", price: "3,130", remark: "" },
  { line: 194, type: "wine/red"          , name: "Chateau Limbourg AOC", size: "750ml", vintage: "2016", price: "1,825", remark: "" },
  { line: 204, type: "wine/red"          , name: "La Pommeraie de Brown Pessac Leognan Rouge", size: "750ml", vintage: "2017", price: "2,010", remark: "" },
  { line: 214, type: "wine/red"          , name: "Chateau Trigant Pessac-Leognan", size: "750ml", vintage: "2016", price: "2,140", remark: "" },
  { line: 224, type: "wine/red"          , name: "Chateau Haut-Vigneau, Pessac-Leognan", size: "750ml", vintage: "2019", price: "1,570", remark: "" },
  { line: 225, type: "wine/red"          , name: "Chateau Herve-Laroque, Fronsac Bordeaux", size: "750ml", vintage: "2018", price: "1,590", remark: "" },
  { line: 237, type: ""                  , name: "low stock    Chateau La Pensee Lalande de Pomerol", size: "750ml", vintage: "2020", price: "1,450", remark: "" },
  { line: 247, type: "wine/red"          , name: "Chateau La Loubiere, Bordeaux Superiur", size: "750ml", vintage: "2020", price: "1,100", remark: "" },
  { line: 258, type: "wine/white"        , name: "Chateau Haut Pougnan Sauvignon Bordeaux", size: "750ml", vintage: "2021", price: "1,170", remark: "" },
  { line: 259, type: "wine/red"          , name: "Chateau Haut Pougnan Bordeaux", size: "750ml", vintage: "2020", price: "1,170", remark: "" },
  { line: 268, type: "wine/red"          , name: "Domaine Philippe Cheron, Chambolle-Musigny Les Quarante Ouvrees", size: "750ml", vintage: "2018", price: "4,160", remark: "" },
  { line: 269, type: "wine/red"          , name: "Domaine Philippe Cheron, Gevrey-Chambertin 'La Rue Des Mees'", size: "750ml", vintage: "2018", price: "4,160", remark: "" },
  { line: 270, type: "wine/red"          , name: "Domaine Philippe Cheron, Vosne-Romanee Les Barreaux", size: "750ml", vintage: "2017", price: "4,440", remark: "" },
  { line: 283, type: ""                  , name: "out of stock    Javelier-Laurin, Bourgogne Pinot Noir", size: "750ml", vintage: "2020", price: "1,500", remark: "" },
  { line: 285, type: ""                  , name: "low stock       Javelier-Laurin, Gevrey-Chambertin 'Les Champs Chenys'", size: "750ml", vintage: "2019", price: "4,490", remark: "" },
  { line: 288, type: ""                  , name: "Javelier-Laurin, Gevrey-Chambertin 1er Cru 'Bel Air'", size: "750ml", vintage: "2020", price: "5,900", remark: "" },
  { line: 291, type: ""                  , name: "Javelier-Laurin, Ruchottes-Chambertin Grand Cru", size: "750ml", vintage: "2017", price: "12,150", remark: "" },
  { line: 302, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Marsannay Blanc 'Les Champs Perdrix'", size: "750ml", vintage: "2020", price: "3,125", remark: "" },
  { line: 303, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Bourgogne Pinot Noir", size: "750ml", vintage: "2020", price: "2,475", remark: "" },
  { line: 304, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 'Cuvee Alexis'", size: "750ml", vintage: "2018", price: "4,490", remark: "" },
  { line: 305, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 'Les Crais'", size: "750ml", vintage: "2019", price: "4,000", remark: "" },
  { line: 306, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 1er Cru 'La Petite Chapelle'", size: "750ml", vintage: "2020", price: "8,405", remark: "" },
  { line: 307, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Gevrey-Chambertin 1er Cru 'Les Chapeaux'", size: "750ml", vintage: "2019", price: "6,540", remark: "" },
  { line: 308, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Marsannay Les Quenicieres", size: "750ml", vintage: "2019", price: "3,420", remark: "" },
  { line: 309, type: "wine/red"          , name: "Jean-Michel Guillon & Fils, Morey Saint Denis 1er Cru 'La Riotte'", size: "750ml", vintage: "2020", price: "7,000", remark: "" },
  { line: 322, type: ""                  , name: "out of stock     Philippe Leclerc, Bourgogne 'Les Bons Batons'", size: "750ml", vintage: "2019", price: "2,320", remark: "" },
  { line: 323, type: "wine/red"          , name: "Philippe Leclerc, Chambolle-Musigny 'Les Babillaires'", size: "750ml", vintage: "2019", price: "4,200", remark: "" },
  { line: 324, type: "wine/red"          , name: "Philippe Leclerc, Gevrey-Chambertin 1er Cru 'Les Champeaux'", size: "750ml", vintage: "2019", price: "4,670", remark: "" },
]

describe('golden table — every product row of the fixture', () => {
  // The first five pages of the fixture, which is what this table was read off.
  // Task 5 appended six more; they are covered by the assembly tests below.
  // Slicing the prefix keeps every line number here exactly as measured.
  const lines = readFixture(joinPath(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
    .split('\f').slice(0, 5).join('\f').split('\n')

  // Walk the fixture the way the parser does and read every line that yields cells.
  const actual: GoldenRow[] = []
  let anchors: ReturnType<typeof columnAnchors> = null
  lines.forEach((line, i) => {
    if (/^\s*(Type|CODE)\s{2,}/.test(line)) { anchors = columnAnchors(line); return }
    if (!anchors || !line.trim()) return
    const row = readRow(line, anchors)
    if (!row.price && !row.size) return
    const matched = matchType(row.left)
    actual.push({
      line: i + 1,
      type: matched ? semanticType(matched.type) : '',
      name: matched ? matched.rest : row.left,
      size: row.size, vintage: row.vintage, price: row.price, remark: row.remark,
    })
  })

  it('finds exactly the rows the fixture prints, and no others', () => {
    expect(actual.map(r => r.line)).toEqual(GOLDEN.map(r => r.line))
  })

  it('reads every cell of every row exactly', () => {
    expect(actual).toEqual(GOLDEN)
  })

  it('never leaves a price that is not a well-formed number', () => {
    for (const row of actual) {
      if (!row.price) continue
      expect(toIntPrice(row.price), `line ${row.line}`).not.toBeNull()
      expect(toIntPrice(row.price)!).toBeGreaterThan(100)
    }
  })
})

// Renders a TypeInfo as "category/colour-or-spirit", which is what actually
// reaches the database. Deliberately not the catalog's own Type key: Rum and Rhum
// are one and the same TypeInfo by design, so a key cannot be recovered from it.
function semanticType(type: TypeInfo): string {
  const tail = type.wineType ?? type.spiritType ?? '-'
  return `${type.category}/${tail}`
}

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
    // Mirrors what row assembly feeds matchType: every line inside a beverage
    // table, headers excluded (blocksOf consumes those) and glassware blocks
    // skipped. A warning here would mean a real product the parser cannot read.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fixture = readFixture(joinPath(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
    let inBlock = false
    for (const line of fixture.split('\n')) {
      if (/^\s*(Type|CODE)\s{2,}/.test(line)) { inBlock = columnAnchors(line) !== null; continue }
      // Assembly strips the stock prefix before it looks at the Type cell, and
      // so must this mirror: "stock   Chateau Cos d'Estournel" is a row whose
      // code arrived on the line above, not an unknown Type cell named "stock".
      if (inBlock && line.trim()) matchType(splitStockPrefix(line.trimStart()).rest)
    }
    expect(warn.mock.calls.map(c => c[0])).toEqual([])
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
// The fixture now holds eleven pages. They are addressed by content, never by
// position: the next person to append a page must not have to renumber tests.

const FIXTURE = readFixture(joinPath(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
const FIXTURE_PAGES = FIXTURE.split('\f').filter(p => p.trim())

// The page of the fixture that contains `marker`. Throws rather than returning
// undefined, so a mistyped marker fails as itself instead of as an empty parse.
function page(marker: string): string {
  const hits = FIXTURE_PAGES.filter(p => p.includes(marker))
  if (hits.length !== 1) {
    throw new Error(`fixture: ${hits.length} pages contain ${JSON.stringify(marker)}, want exactly 1`)
  }
  return hits[0]
}

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

import { parseCatalogText } from './lovely'
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

describe('parseCatalogText — tables, banners and whole data rows', () => {
  it('yields nothing at all from the glassware and ashtray page', () => {
    const items = parseCatalogText(page('ZALTO GLASPERFEKTION'))
    expect(items).toEqual([])
  })

  it('reads the spirits page whose Type words are glued to the product name', () => {
    const items = parseCatalogText(page('MAISON GELAS'))
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
    const items = parseCatalogText(page('CHATEAU HAUT POUGNAN'))
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
    const items = parseCatalogText(page('MAISON GELAS'))
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
    const items = parseCatalogText(page('CANARD-DUCHÊNE'))
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
    const items = parseCatalogText(page('GOUTORBE-BOUILLOT'))
    expect(shape(items, "'Le Ru Des Charmes'")).toEqual(['750ml/-/2570'])
    expect(shape(items, "'Reflets De Riviere'").sort()).toEqual(['375ml/-/1440', '750ml/-/2010'])
  })

  it('lets a vintage-variant row inherit the size from its name row', () => {
    // Without inheritance both of these land with volume: null.
    const items = parseCatalogText(page('ALDRIDGE'))
    expect(shape(items, "'Twynham' Chardonnay")).toEqual(['750ml/2024/590', '750ml/2025/-'])
    expect(shape(items, "'Rams Head'")).toEqual(['750ml/2023/590', '750ml/2024/-'])
  })

  it('spreads a single price over the vintages centred against it', () => {
    const tollo = parseCatalogText(page('CANTINA TOLLO'))
    expect(shape(tollo, "'Rocca Ventosa' Pinot Grigio"))
      .toEqual(['750ml/2023/840', '750ml/2024/840', '750ml/2025/840'])

    const yangarra = parseCatalogText(page('YANGARRA ESTATE VINEYARD'))
    expect(shape(yangarra, "'GSM'")).toEqual(['750ml/2017/2120', '750ml/2021/2120'])
  })

  it('pairs sizes, vintages and prices positionally when each is printed', () => {
    const muga = parseCatalogText(page('MUGA'))
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
    const items = parseCatalogText(page('GIUSEPPE CORTESE'))
    expect(shape(items, 'Barbaresco, Rabaja')).toEqual(['750ml/2017/4105', '750ml/2019/4105'])
    expect(shape(items, 'Barbaresco Reserva')).toEqual(['750ml/2013/6920'])
    expect(shape(items, 'Langhe, Nebbiolo')).toEqual(['750ml/2022/1580'])

    const bussola = parseCatalogText(page('BUSSOLA TOMMASO'))
    expect(shape(bussola, "'Recioto' Della Valpolicella Classico TB").sort())
      .toEqual(['500ml/2017/3320', '500ml/2018/3320', '500ml/2019/-', '750ml/2008/5685'])
    expect(shape(bussola, 'Valpolicella Ripasso')).toEqual(['750ml/2019/1640', '750ml/2020/-'])
  })

  it('keeps every row of a five-row cluster with its own product', () => {
    const items = parseCatalogText(page('LA RIOJA ALTA'))
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
