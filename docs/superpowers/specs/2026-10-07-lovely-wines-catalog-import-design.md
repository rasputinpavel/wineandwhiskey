# Lovely Wines catalog import — design

**Date:** 2026-10-07
**Status:** approved, awaiting implementation plan
**Source file:** `.inbox/Lovely Wines Catalog_Sep Claudio.pdf` (64 pp. A4, text layer present, PDF ModDate 2026-09-01)

## Problem

Lovely Wines Company Limited is a new supplier — none of the 26 rows in `suppliers`
matches it. Their September 2026 catalog needs to land in `wine_items` through the
mission-control price pipeline (`/m/price`), the same way the other 19 suppliers do.

The catalog is not a flat table. It is a designed document: a category banner per
page, a region banner under it, a prose paragraph about the producer, and then one
small table per producer. Multi-size items are typeset with the product name
vertically centred between its size/price rows, so the name line carries neither a
size nor a price:

```
                                      750ml                      2,710
CP   Canard Duchene Champagne 'Cuvee Leonie' Brut   14.5   NV
                                     1500ml                      5,520
```

Naive line-by-line parsing drops or mangles those rows — roughly 186 of the ~909
price-bearing lines are affected.

## Scope

**In:** wine and spirits — ~1,262 positions (see the audit table; each vintage of a
wine is its own position with its own price).
**Out:** glassware and the cigar ashtray (23 positions, the `ACCESSORIES` pages).
They are not beverages; they have nothing to do in the price browser or in Vivino
enrichment, and every other parser behaves the same way.

## Prices: retail, not our cost

The printed numbers are **retail** and **VAT-exclusive** ("NOTE : Prices are Vat
Exclusive"). Our purchase price is about 20% lower.

The parser writes **the printed number, verbatim, with no arithmetic**. That is the
invariant every one of the 19 existing parsers holds, and it keeps a re-read of the
PDF reconcilable with the database down to the baht. The discount is supplier
knowledge, not item data, so it is recorded in the supplier profile instead.

Consequence to accept knowingly: in the price browser Lovely Wines will look ~20%
more expensive than it is when compared against suppliers who quote cost. A real
two-price model (`price_retail` + a per-supplier discount, computed in the portal)
is a separate phase with its own migration and UI work, and is explicitly not part
of this one.

## Where the code lives

- `02_services/mission-control/lib/price/parsers/lovely.ts` — the parser.
- One entry in `PARSERS` (`lib/price/parsers/index.ts`), in the
  "PDF: deterministic" block, wrapped with `wrap()` like `bbb`.
- `lib/price/parsers/lovely.test.ts` + a fixture.

No DB migration. No change to `app/api/m/price/price-lists/route.ts`, to
`lib/price/supabase.ts`, or to the `ExtractedItem` type.

### Detection

```
isLovely(buf, filename):
  filename matches /lovely/i                                  → true
  page 1 text matches /LOVELY WINES COMPANY LIMITED|lovelywines\.co\.th/i → true
```

Canonical `supplier_name`: `Lovely Wines Company Limited`.

`price_list_date` is not printed anywhere in the catalog — a `grep` over the whole
text layer finds no date at all. So it is derived, in this order:

1. a `YYYY-MM` in the filename;
2. a month name in the filename (`..._Sep Claudio.pdf` → September), paired with
   whichever year places that month **nearest** the PDF's ModDate — not ModDate's own
   year, or a January catalog mailed in late December dates to the January just gone;
3. the PDF ModDate itself (`2026-09-01T10:10:30Z` for this file);
4. `null`.

The filename is reduced to its basename first and months are matched as a closed
list with word boundaries: a prefix match on `/jan|feb|…/` reads `Decanter` as
December, `Novelties` as November and `Janhom` — another supplier in this repo — as
January. Dates are formatted in `Asia/Bangkok`, where both the supplier and the shop
are; formatting in UTC (as Railway containers do) turns a ModDate of 2026-09-01 00:30
Bangkok into 2026-08-31, the wrong month for a price list.

A wrong or missing date is not a blocker — the date is editable in the price list
screen — but it decides which catalog freshness marks current, so it is worth
getting right automatically.

### Parsing approach: deterministic, zero LLM calls

Measured on the real file before choosing: every one of the 923 size cells, 598
vintage cells and 860 price cells sits within a few characters of its header's
column — real offsets are −8..+1 for sizes, −1..+5 for vintages and −4..+4 for
prices. The layout is a genuine character-aligned table, so the values can be located
exactly and prices come out to the baht. An LLM pass would cost ~25 calls per upload
and could misread a digit; there is nothing it would buy here. Grape variety is the one field the tables do not carry,
and Vivino enrichment already fills it.

Algorithm:

1. `pdftotextLayout(path, 1, 0)` over the whole document; split on `\f` into pages.
2. Per page, track context:
   - **centred all-caps banner** (indent > 30) → category or country:
     `CHAMPAGNE`, `PROSECCO`, `CAVA`, `DESSERT WINE`, `FORTIFIED WINE`, `SPIRITS`,
     `ACCESSORIES`, or a country (`ARGENTINA`, `FRANCE`, `ITALY`, `USA`, …).
     Context carries across pages — a producer table can start on a page whose
     banner repeats the previous one.
   - **left-indented sub-banner** → region (`MENDOZA`, `KAMPTAL`, `PENEDES`) or,
     on `SPIRITS` pages, the country (`DOMINICAN REPUBLIC`, `SRI LANKA`).
   - **prose paragraph** between banner and table header → producer description.
3. A table starts at a header line matching `^\s*(Type|CODE)\s{2,}` that contains
   `Size`. Column anchors come from the positions of the labels `Size`, `Alc%`,
   `Vintage`, `Price`, `Remark`.
4. **A beverage table is recognised by requiring `Alc%` in its header**, not by
   blocklisting glassware wording. Measured over all 262 headers in the catalog,
   exactly 4 lack `Alc%` and they are precisely the cigar ashtray and the three
   glassware tables — so the positive test is provably exact here, and unlike a
   blocklist it does not depend on guessing next month's column labels. Labels are
   matched as whole tokens: `indexOf('Price')` also finds the `Price` inside
   `Price/Pcs`.
5. **Cells are found by regex near each anchor, never by slicing the line at it.**
   Variant size cells print up to 8 characters left of the `Size` label, so a hard
   slice cuts `1500ml` into `15` + `00ml` and the fragment lands in the product name.
   This is the most common way a naive implementation corrupts this catalog.

   The search window is **clamped per table** to half the distance to the neighbouring
   anchor, capped at 8. A flat ±8 is not safe: in three real tables the `Remark`
   anchor sits only 6 to 8 characters from `Price`, so a critic score printed at the
   `Remark` anchor is read as the price — `91 WS` becomes ฿91. Token boundaries matter
   as much as the window: without them `102000` matches as `02000` and the ABV `37.50`
   as `50`, and a located price that is the same match as the located vintage must be
   discarded.

### The one rule behind every layout trap

**A cell typeset alone on its line is vertically centred, and belongs to the
adjacent rows that lack that cell.**

The catalog applies this to every column, not just one. A first reading of the file
found it on names and bottle sizes; checking a code reviewer's claims turned up four
more shapes, all the same rule wearing a different hat:

- **a name centred between its size rows** — one wine, two bottle sizes
  (Canard-Duchêne `'Cuvee Leonie'`: 750ml / 1500ml);
- **a name and size centred between vintage rows** — one wine, several vintages, the
  name row carrying the size and ABV while the rows above and below carry year and
  price (Aldridge `'Twynham' Chardonnay`: 2024 / 590 and 2025 / pending). ~62 rows.
  The variant row has **no size of its own and must inherit it from the name row**,
  or the position lands in the database with `volume: null`;
- **a price centred between vintage rows** — several vintages sharing one price
  (Yangarra `'GSM'`: 2017 and 2021 at ฿2,120). This is the catalog's house style,
  not an exception: 213 products price two, three or four vintages off one number;
- **a name wrapped over two lines with the type code between the halves** — the
  continuation line carries its own vintage and price (Realm Cellars
  `'Houyi Vineyard'`, Comtesse de Cherisey `'La Genelotte'`). 42 such lines. Treating
  the continuation as a product of its own would file a junk position named
  "Cabernet Sauvignon" at ฿12,800;
- **a stock remark torn across lines** — `low` ends up on the type code's line and
  `stock` prefixes the name on the next one (`low R` / `stock   Chateau Cos
  d'Estournel`). The type code is lost unless the stock fragment is stripped first.

Implement the general rule once rather than five special cases.

**What is NOT a rule.** An earlier draft of this design said "a row that already
carries both its own size and its own price collects nothing", as the way to stop
Goutorbe-Bouillot's 750ml / ฿2,010 variant being stolen by the next product (which
really costs ฿2,570). That absolute is false: Bussola's `'Recioto' … TB` 500ml
carries its own `500ml / 2018 / ฿3,320` **and** owns the `2017 / ฿3,320` row above it
and `2019 / pending` below (coordinates: 10.6pt and 10.7pt inside the cluster against
14.1pt and 13.9pt to the neighbours). La Rioja Alta, Muga Reserva and Viña Ardanza
behave the same way. The Goutorbe case has to fall out of the general grouping —
column regularity plus centring — not out of a hard-coded exemption.

### Read coordinates, not character columns (decided 2026-10-08)

The first implementation read `pdftotext -layout` and reconstructed which rows belong
to which product from the text alone, using a cost model over column regularity and
centring, solved with a dynamic program. It came out 1,261 of 1,262 positions right —
and the one it got wrong proved the approach cannot be fixed by tuning.

Page 14, in the PDF's own word coordinates:

```
y=549.0        2019
y=553.0  +4.0  R Hermandad, Blend (Malbec/ Cab/ Merlot/ Petit Verdot)  750ml 14.5 1,490
y=557.7  +4.7  2022      ← 4.7pt below Blend's row: it is Blend's
y=571.6 +13.9  2022      ← 13.9pt: a new product starts here
y=575.6  +4.0  R Hermandad, Malbec                                     750ml 14.5 1,490
y=579.6  +4.0  2023
```

`-layout` merges baselines 4pt apart onto one text line, so in the text `2019` lands on
Blend's line and the second `2022` on Malbec's, leaving the first `2022` exactly
equidistant between the two products. **The ownership information is not in the text
layer at all**, so every heuristic is guessing; four cost-tuple variants were measured
and all were worse. The consequence today is that `Hermandad, Blend … 2022 @ ฿1,490`
is missing from the import, hidden because the stolen row became a duplicate that
deduplication swallowed. With different prices the same shape invents a price instead
of dropping one.

So the geometry layer reads **`pdftotext -bbox`** instead:

- a **row** is the words sharing a `yMin`;
- a **cluster** is consecutive rows whose vertical gap is under **12.5pt**. Measured
  over the whole catalog: 424 gaps at 5pt and 443 at 14pt, with the nearest values to
  the threshold being 11pt and 13pt — a 2pt margin on both sides. Bussola's Recioto,
  which broke the earlier absolute rule, sits at 10.6pt inside against 14.1pt between;
- a **column** is assigned by comparing a word's `xMin` against the header words'
  positions — exact, so the character-window arithmetic, its per-table clamping and
  the whole cost model and dynamic program are deleted rather than fixed.

Everything above the geometry layer is unchanged: the Type vocabulary, the line roles,
the banners and context, `pending`, the separator oddities and item construction all
stay as they are, and their tests stay green.

**How a cluster's boundaries are found in the text layer (superseded, kept for the
reasoning).** `pdftotext -layout` flattens the vertical
gaps that separate one product from the next: a 5pt gap inside a cluster and a 14pt
gap between products both arrive as a single newline. So the grouping is reconstructed
from what the cells themselves say — a column is printed once per row or once per
group of rows, so 4 vintages against 4, 2 or 1 prices is regular while 4 against 3 is
not, and a product's extra rows are centred on its own row. Solving those two
constraints across a table reproduces every printed cluster; the PDF's own word
coordinates confirm it (within the Yangarra `'GSM'` cluster the gaps are 5.3pt, and
the gap before the next product's first row is 14.1pt).

**Where the rule runs out.** Of 214 clusters in the catalog, 213 are of the form
"these N vintages all cost X" and carry no ambiguity at all. Exactly **one** is
genuinely ambiguous — Domaine J.A. Ferret, Pouilly-Fuissé Cuvée Hors Classe
`'Tournant De Pouilly'` (page 36), four vintages against two prices. The audit prints
every cluster where vintages outnumber prices so that one can be checked by eye.
Identical (volume, vintage, price) triples within one product are deduplicated as a
safety net, though with the clusters read correctly nothing in this catalog triggers
it.

### Line roles inside a table block

`pdftotext` does not give one line per product. These patterns appear, all verified
against the real file:

- **data line** — carries size and/or price in their columns. Yields an item. Its
  type comes from the leading code on the line, or from a pending code (below).
- **variant line** — no left-hand text, but both size and price. It is another
  bottle size of a neighbouring product whose own name line carries no size or
  price. Attach it to the contiguous nameless name row above or below.
  **A name row that already carries its own size and price never absorbs
  neighbours.** Without this rule Goutorbe-Bouillot's 750ml / 2,010 variant gets
  misassigned to the next product, which prints 2,570 — a wrong price in the
  database, silently.
- **code-only line** — the whole line is just a type code (`     R`). The code
  belongs to the next data line. This happens whenever a row also carries a stock
  remark.
- **remark-only line** — the whole line is a rating (`91 WS`, `90 VN`) or a stock
  state (`low stock`, `out of stock`). Ratings are typeset vertically centred
  around their product, so they may sit above *and* below its name row; both
  belong to that product. Attach to the adjacent name row — the one above when its
  own Remark cell is empty, otherwise the one below.
- **stock-prefixed data line** — the stock remark is rendered at the far left edge,
  before the name: `low stock    Chateau La Pensee Lalande de Pomerol  750ml …`.
  The leading `low stock` / `out of stock` / `stock` must be stripped off the name
  and moved into the remark, or it ends up inside the product name in the database.
- **name-continuation line** — left-hand text that matches nothing in the Type
  vocabulary and is not a stock prefix, but ends before the `Size` column. It is the
  tail of the previous name row; append it to that name, and treat its own cells as
  another variant of that product.
- **prose / banner line** — anything else. Feeds the context described above.
  Prose is told apart from a name continuation by where it ends: a producer
  paragraph wraps out past the `Size` column and into the cell area, a name fragment
  stops before it. Because a block also ends at the next banner, only two prose lines
  in the whole catalog ever reach a table block at all.

Two further details the real file forces:

- **`pending` is a price** — the catalog prints the word instead of a number on 57
  positions. They are real positions with no price yet, so `price` is `null` and the
  row is still emitted. "Zero positions without a price" was therefore never an
  achievable target. Two further oddities account for the rest of the 59 priceless
  positions: Giuseppe Cortese `'Scapulin'` has an empty Price cell, and Dumol Meteor
  Vineyard prints `4,.395`, which is not a number any rule should guess at.
- **Three prices use a dot as the thousands separator** — `1.970`, `1.020` and
  `5.330`. The catalog never prices with decimals, so in the price cell
  `\d{1,3}\.\d{3}` is a separator and is read as such, with a warning naming the
  row. Read without boundaries, `1.020` yields 20 — a ฿1,020 bottle imported at ฿20.
- **Banner text uses typographic hyphens** (`ENTRE‑DEUX‑MERS`, U+2011). A banner
  matcher restricted to ASCII `-` silently drops those banners and leaks their region
  into the next producer's rows.

Each size variant becomes its own `ExtractedItem`: volume is a separate column and
the reconciler keys on name plus volume, so two sizes are two positions.

### The Type column vocabulary

The Type cell is not separated from the product name by a reliable gap — spirits
rows print `Armagnac Gelas, Bas Armagnac 8 Ans` with a single space. So the Type
cell is recognised by a closed vocabulary, longest match first, anchored at the
start of the left-hand text. Counted over all 921 data rows in this catalog:

- **codes:** `R` 505, `W` 186, `SP` 26, `CP` 17, `RO` 9, `DW` 7, `FW` 3, `SW` 1,
  `CP RO` 2, `SP RO` 2, `RO SP` 1
- **words:** `Whisky` 35, `Rum` 12, `Armagnac` 8, `Cognac` 8, `Sherry` 6,
  `Calvados` 6, `Gin` 5, `Brandy` 5, `Fortified` 4, `Rhum` 3, `Eau-de-Vie` 2,
  `Vermouth` 2, `Liqueur` 1, `Aperitif` 1, `Vodka` 1, `Ceylon` (Ceylon Arrack) 1

A data row whose left-hand text matches nothing in this list is a parser bug, not a
row to drop silently — the coverage check below is what catches it.

### Field mapping

| Catalog | `ExtractedItem` |
|---|---|
| Type code `R` / `W` / `RO` / `SP` / `CP` | `wine_type` `red` / `white` / `rose` / `sparkling` / `sparkling` |
| Type code `DW` / `FW` / `SW`, Type word `Sherry` / `Vermouth` / `Fortified` | `category: 'wine'`, `wine_type: null`, the term appended to `description`. These are wines, fortified or sweet — routing them to `spirits` would misfile Lustau's sherries |
| Type code `SP RO` / `CP RO` / `RO SP` | `sparkling` — the word Rosé is already in the product name, and the price browser is more useful with these under sparkling |
| Type word `Whisky` / `Rum` / `Rhum` / `Gin` / `Vodka` / `Brandy` / `Cognac` / `Armagnac` / `Calvados` / `Eau-de-Vie` / `Liqueur` / `Aperitif` / `Ceylon` | `category: 'spirits'`, `spirit_type` normalised (`Rhum` → `rum`, `Ceylon` → `arrack`) |
| Page banner / sub-banner | `country`, `region`. `CHAMPAGNE` → France, `PROSECCO` → Italy, `CAVA` → Spain |
| `Vintage` | `year`; `NV` → `null` |
| `Size` | `volume`, kept as printed (`750ml`) |
| `Price` | `price`, the printed number, thousands separator stripped, no arithmetic |
| `Remark` — ratings (`88 WE`, `91 WS`, `90 JS`, `94 VN`) and stock states (`low stock`, `out of stock`) + producer paragraph | `description`, one line |
| — | `grape_variety: null` (Vivino fills it), `supplier_sku: null` |

Rows printing no price (out of stock / on request) yield `price: null`, as in
Richly's `N/A` handling.

`winery` is deliberately not populated: the upload route does not pass that column
through, `ExtractedItem` has no such field, and the producer name is already part of
every product name. Widening the shared route for one supplier is not worth it.

## Testing

**Fixture test.** Pages 2, 3 and 9 of the catalog, chosen because between them they
contain every hard case: glassware to be skipped (p. 2), multi-size items and
vertically centred double ratings (p. 3, Canard-Duchêne and Paul Bara), the
no-absorb case that would otherwise take a neighbour's price (p. 3,
Goutorbe-Bouillot), and a spirits table whose Type column holds words glued to the
name (p. 9, Maison Gelas). The stock-prefix case lives further in, so the fixture
also takes the Javelier-Laurin and Chateau La Pensee tables.

The test runs the pure text-parsing function against the `pdftotext -layout` output,
the way `smd.test.ts` tests pure helpers. Assertions: position count, the multi-size
split, prices exact to the baht, no glassware, no `low stock` left inside a name.

**Coverage check** (one-off, run during implementation, not committed as a test).
A script counts every line in the raw `pdftotext` output that carries cells, and
compares that against the parser's output. The bar is **zero unexplained lines**:
each one either became a position or was deliberately skipped as glassware.

Targets, with the numbers measured on the September file:

| Check | Target |
|---|---|
| positions parsed | ~1,262. Each vintage is its own position with its own price, which the earlier estimate of ~886 missed: it counted lines carrying a size, and vintage rows carry a vintage and a price but no size |
| positions with no price | 59 — 57 `pending`, one empty cell, one printed `4,.395` |
| positions with no country | 0 |
| positions with no category | 0 — a row that kept a pending type means a code line was lost |
| `stock`, `ml` or a leading digit inside a name | 0 |
| ambiguous clusters (vintages outnumber prices) | printed as a list; 214 total, of which 213 are "N vintages share one price" and exactly 1 needs an eye |
| names beginning with a digit | exactly 1 — `30&40 Double Jus (Aperitive de Normandie)` is a real product |

Two numeric traps the audit must also cover, both found by code review of the first
implementation and both one character from firing on real data: a critic score read
as a price (the `Remark` anchor sits exactly 8 characters from `Price` in three
tables, so the ±8 search window must be clamped per table to the midpoint between
anchors), and a price token read without boundaries (`102000` → `02000`, and the ABV
`37.50` → `50`, which sits 3 characters outside the window today).

## Supplier profile

`07_contacts/partners/lovely-wines/profile.md`, following the `templates/` card:

- Claudio Bonato, Sales and Marketing Executive — claudio@lovelywines.co.th,
  +66 63 209 7488, Line `claudiolw`
- Bangkok: 28 Soi Krungthep Kreetha 27, Thap Chang, Saphan Sung, 10250 — 02-318-1588
- Phuket: 96/27, 96/28 Moo 1 Kathu, 83150 — 063-912-4107
- Hours 10:00–19:00, closed Sunday; www.lovelywines.co.th
- **Catalog prices are retail, VAT-exclusive; our discount is about 20%.**

That last line is the point of the card. Without it, the number in the price browser
reads as our cost within a month.

## Import run

Upload the PDF through the portal at `/m/price`, leaving the "update an existing
supplier" selector empty — Lovely Wines is a new supplier, not a new version of an
existing catalog. Then check the position count and spot-check a few prices against
the PDF. The next monthly catalog is uploaded with the selector pointed at Lovely
Wines, so freshness marks September expired and the new one current.
