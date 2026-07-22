# SMD Price-List Parser — Design

**Date:** 2026-07-22
**Status:** Approved design, pre-implementation
**Trigger:** New supplier **SMD** (Smiling Dark Horse) sent two price-list brochures. It is the only folder in `.inbox/Suppliers/` without a matching supplier-specific parser, so uploads currently fall through to the generic LLM extractor, which loses items on multi-page magazine layouts.

## Problem

The price-list subsystem routes each uploaded file through `lib/price/parsers/` — one bespoke parser per supplier (~18 today). A parser that owns a supplier's layout beats the generic fallback because the generic chain (pdftoppm → text → vision) drops items to LLM token limits and dedup-by-name collisions on large catalogs. SMD has no parser, and its two files are 11–14-page magazine grids (~200+ items total) — exactly the case the bespoke parsers exist for.

## Source files

Both in `.inbox/Suppliers/SMD/`, text-extractable (Adobe PDF, A4, not scans):

- **`SMD_BROCHURE_WINE_JUL26.pdf`** — 14 pp. "DARK HORSE POURING" pouring wines. Grid of ~4 cards per row band. Each card: `COUNTRY / PRODUCER (multiline) / appellation / grape composition / YEAR / ABV% / PRICE` (e.g. 330, 360, 410).
- **`SMD_BROCHURE_GCC1855.pdf`** — 11 pp. "Grand Cru Classé 1855" fine Bordeaux. Cover on p.1. Grid cards: `CHÂTEAU / appellation (St-Julien, Pauillac, Margaux, St-Estèphe…) / YEAR / PRICE` (e.g. 9,400 → 9400). Section headers like "Second Growth / Deuxième Grand Cru Classé".

`pdftotext -layout` extracts text but interleaves the grid columns — deterministic column reconstruction is fragile. Claude reads the PDF natively and reconstructs cards reliably.

## Decisions (locked)

- **Supplier name:** `SMD` (slug `smd`) — single supplier for both brochures. The upload route find-or-creates the `suppliers` row from `supplier_name`; verify no conflicting existing `smd` slug during implementation.
- **Both brochures now:** one parser, two variants (`wine`, `gcc1855`), each with its own prompt and `detectVariant` branch.
- **Pricing:** the printed number is the **bottle price in THB, VAT-exclusive** ("ALL PRICE ARE SUBJECT TO VAT 7%"). Store the number as-is. Default `volume` = `750ml`.
- **Approach:** bespoke LLM parser modeled on `lib/price/parsers/universal.ts` (one supplier, multiple catalogs, `detectVariant`), using the shared `callWithPdf` native-PDF path like `janhom.ts`.
- **Full integration:** register in `lib/price/parsers/index.ts`; works through portal upload + the existing extraction route; deploys automatically to Railway on push to `main`.

## Non-goals (YAGNI)

- No reconciliation work. Reconciliation (`reconcile.ts` + apply route + migration 010) is built but **not merged to `main`**; the main upload path is direct-insert. SMD lands as two dated catalogs under one supplier — no change to that path.
- No deterministic text/column parser (approach B rejected).
- No new shared helpers — reuse `parsers/_shared.ts` (`getPageCount`, `extractPdfPages`, `callWithPdf`, `parseJson`, `dedupBy`, `pdftotextLayout`, `writeTemp`, `safeUnlink`).
- No changes to `/russian-wine` landing or consignment settlement.

## Architecture

New file **`02_services/mission-control/lib/price/parsers/smd.ts`**, exporting `isSMD` and `parseSMD`, plus one entry in `parsers/index.ts`. Same shape as every other parser:

```ts
export async function isSMD(buf: Buffer, filename: string): Promise<boolean>
export async function parseSMD(buf: Buffer, filename: string, onProgress?: ProgressCb): Promise<ExtractionResult>
```

`extract.ts` already prefers a supplier parser over the generic fallback (`findMatchingParser` → first `detect()` that returns true), so registration is the only wiring needed.

### Detection

`isSMD`:
1. Filename match `/smd|dark[\s_-]?horse|gcc\s?1855/i` → true (fast path).
2. Else read page 1 text via `pdftotextLayout` and match `/SMILING\s+DARK\s+HORSE|DARK\s+HORSE\s+POURING|GRAND\s+CRU\s+CLASS[EÉ]\s+1855/i`.

`detectVariant(filename, firstPageText)`:
- `gcc1855` if `/gcc|1855|grand\s+cru/i` in filename or first page.
- else `wine`.

### Parse flow (mirrors `janhom.ts` / `universal.ts`)

1. `getPageCount(buf)`; read page 1 text to pick the variant.
2. Build a chunk plan: 2 PDF pages per chunk, starting after the cover (`wine` from p.1, `gcc1855` from p.2 — verify exact first product page during implementation).
3. Process chunks with `PARALLEL = 5`: `extractPdfPages` → `callWithPdf(promptFor(variant), chunkBase64)` → `parseJson<{items}>`; per-chunk try/catch returns `[]` on failure (one bad chunk never sinks the run). Log per-chunk item counts.
4. Report progress 5 → 95% proportional to chunks done.
5. `dedupBy(items, it => name|year|price)`; return `{ supplier_name: 'SMD', price_list_date: null, currency: 'THB', items }`.

### Prompts

Two grid-aware prompts returning `ONLY {"items":[...]}` with the `ExtractedItem` shape (`name, country, region, grape_variety, price, year, volume, description, category, wine_type, spirit_type`).

- **wine:** one item per card. `category:'wine'`; `volume:'750ml'` default; `price` = integer THB (strip thousands separators); `year` = vintage or null (NV); `wine_type` inferred from grape/name (sparkling/rosé/white/red); `region` = appellation; `country` from the card's country line; producer folded into `name`.
- **gcc1855:** `category:'wine'`, `wine_type:'red'` default (override if a white/sparability is shown), `country:'France'`, `region` = appellation, `name` = "Château …", `price` integer (`9,400`→`9400`), growth classification (e.g. "Second Growth") into `description`.

## Error handling & edge cases

- **Parse/API failure:** per-chunk failures degrade to `[]`; a total failure propagates and the route sets `price_lists.status='error'` with the message (existing behavior).
- **Thousands separators / stray glyphs:** prompt instructs integer THB; a post-parse numeric coercion strips commas as a guard.
- **Two brochures, one supplier:** both direct-insert as separate dated catalogs — fine on `main`. (When reconciliation later merges, multi-catalog-per-supplier scoping by `kind` is a pre-existing concern shared with Universal, out of scope here — noted for the reconciliation work.)
- **Non-750ml bottles** (halves/magnums, if any appear): prompt captures an explicit size when printed, else defaults to `750ml`.

## Testing

Follow the existing `lib/price` conventions:

- **Unit (no API):** `isSMD` true on both real filenames and on first-page text; false on a non-SMD sample. `detectVariant` returns `gcc1855`/`wine` correctly. Fixtures = 1–2-page slices of each brochure in `lib/price/__fixtures__/` (or the parser test dir the repo already uses — confirm during implementation).
- **Extraction smoke (manual, one run):** run the real parser against both PDFs; assert plausible counts (wine ≥ ~150 items, gcc1855 ≥ ~30), spot-check a few known cards (name/vintage/price), confirm currency THB and default volume. Record expected counts in a comment; do not hit the API in CI.

## Open questions

None blocking. Exact first-product page per brochure and any non-750ml sizes are resolved by reading the PDFs during implementation.
