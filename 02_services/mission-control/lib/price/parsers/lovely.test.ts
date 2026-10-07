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
    const fixture = readFixture(joinPath(__dirname, '../__fixtures__/lovely-pages.txt'), 'utf8')
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
