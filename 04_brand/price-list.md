# Price List — layout guideline

The canonical design for Wine & Whiskey printed/shareable **price lists**. This is the
source of truth the generator implements. Reference image:
`.inbox/WhatsApp Image 2026-07-25 at 10.49.05.jpeg`.

> **Generator:** Portal → **Marketing → Price Lists** (`/m/pricelist`). Assemble from the
> store catalog, a CSV/Excel upload, or manual rows; export A4 PNG pages + a PDF.
> Design spec: [`docs/superpowers/specs/2026-07-25-pricelist-builder-design.md`](../docs/superpowers/specs/2026-07-25-pricelist-builder-design.md).

## Card anatomy

Each wine is one card, read left → right:

```
┌──┬────────┬─────────────────────────────┬──────────┐
│P │ bottle │ NAME (bold, uppercase)      │  540 .-  │
│L │ photo  │ 🌍 country, region          │  (Bebas) │
│A │        │ 🍇 grape                    │          │
│Q │        │ 🍾 volume (optional)        │          │
└──┴────────┴─────────────────────────────┴──────────┘
```

1. **Plaque** — vertical colour band on the left edge, caption set vertically (WHITE / RED / …).
   The plaque colour is the wine's category zone (see below).
2. **Bottle photo** — label cutout on transparent background (`04_brand/products/<sku>.png`).
   When absent, a neutral bottle silhouette placeholder.
3. **Name** — bold, UPPERCASE, 1–2 lines.
4. **Meta rows** — 🌍 country/region, 🍇 grape, 🍾 volume (only the rows that have data).
5. **Price** — large, right-aligned, with a `.-` suffix (`540.-`). No ฿ glyph; the currency is
   implicit and the footer states VAT.

## Plaque zone system

The colour band is the fast visual index — the eye finds the category by colour, not by reading.
Colours are brand tokens (see [`design-system.md`](design-system.md) §2 / `design-tokens.json`).

| Zone | Colour | Token |
|------|--------|-------|
| WHITE | muted amber-gold | `amber-gold` `#C9A84C` |
| RED | wine red | `wine-red` `#8C1C1C` |
| SPARKLING | eucalyptus teal (distinct from WHITE gold) | `#5E9B8E` |
| CHAMPAGNE | golden metallic gradient (its own premium type) | `linear-gradient` gold |
| ROSÉ | dusty rose | `rose-dust` `#C98C8C` |
| SPIRITS | graphite / whisky-brown (echoes "& WHISKEY") | `graphite` `#3D3D3D` |

`orange` wine folds into the WHITE zone (v1). SPARKLING intentionally shares gold with WHITE
but carries a bubble texture so the two stay distinguishable in a warm palette — the exact
sparkling treatment (gold+bubbles vs a cool mint accent) is chosen visually on the first render.

## Grid & row layouts

Base principle: **two cards per row.** Left/right columns are a consequence of grouping, not a
hard white-left/red-right rule. A rendered page is a stack of rows, each one of:

- **pair** — two cards (default).
- **solo-wide** — one full-width card (a lone item in a group, or a deliberate premium accent).
  A trailing odd item in a group becomes solo-wide by default (`oddItemMode: 'solo-wide'`), or
  stays a half-width lone card (`'tight'`).
- **divider** — a group heading band (`RUSSIA · KUBAN`, `SPARKLING`, a price tier…). Optional;
  off reproduces the reference, which has no dividers.

**Groupings:** by producer, type, region/country, price tier, grape, a curated set, or manual
order. Pagination: ~14 cards per A4 page; a divider is never orphaned at the foot of a page.

## Typography

Three brand roles (all Google Fonts; see `design-system.md` §3):

- **Prices** — **Bebas Neue** (`font-display`), heavy condensed, with the `.-` suffix.
- **Wine names** — **DM Sans** bold, UPPERCASE (`font-heading`).
- **Meta, dividers, footer** — **Inter** / DM Sans (`font-sans`).

## Header band

A bordered rounded band at the top of the first page:

- **Left:** QR code + `PLACE AN ORDER › / СДЕЛАТЬ ЗАКАЗ` + the order contact
  (e.g. `WhatsApp · Irina +66 93 914 0004`).
- **Right:** the **WINE & WHISKEY** wordmark, large and prominent (WINE in wine-red, & WHISKEY
  in ink). The logo stays a confident anchor — never shrink it into the corner.

## Footer

Centred, on every page: the VAT note, e.g. **`7% VAT NOT INCLUDED`**. State the VAT rule
plainly so there are no surprises at the till — dry and honest, never fine-print.
