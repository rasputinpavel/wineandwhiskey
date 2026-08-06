давай# Wine Assistant Bot («Алан») — Design

**Date:** 2026-06-23
**Status:** Approved (design); implementation plan pending
**Location:** `01_agents/alan/`

## Summary

A standalone Telegram bot — a realist sommelier named **Алан** — that helps store
staff with two jobs:

1. **Assess a wine** — from a label photo, a typed name, or a voice note. Returns an
   *honest* verdict: what the wine actually is, what critics vs. the crowd say, whether
   it is worth its price, and a bottom line (take it / skip it / overpriced). Not
   marketing fluff.
2. **Find analogues** — given a wine, suggest globally-available similar wines by style,
   level, and price. Not restricted to the shop's catalogue or stock.

Audience: store staff. Language: auto-detected per message (Russian message → Russian
reply, English → English). Inputs: photo, text, voice.

## Why this shape (research-backed)

A deep-research pass (2026-06-23, 22 sources, 21 verified findings) established that
**no clean, free, programmatic source of professional critic scores exists** for a small
operator:

- **LWIN (Liv-ex)** — free CC BY 4.0 identity DB (200k+ wines), but identity only — no
  scores/prices/notes.
- **Liv-ex paid APIs** (Critic/Price/Wine Data) — authoritative scores (Jancis Robinson,
  Parker, Vinous) + market prices, but paid and gated to wine-trade members.
- **Vivino** — no official API; only ToS-violating third-party scrapers. Community
  rating (1–5) + taste profile; correlates with critics only ~r≈0.40 (Bordeaux study).
- **Wine-Searcher** — ideal *normalization model* (collapses 100/20/5-pt scales into one
  100-pt Bayesian aggregate, covers edge regions), but blocks scraping (HTTP 403).
- **Kaggle Wine Enthusiast** — static, frozen at 2017, scores censored to 80–100.

**Consequence:** the core engine is **Claude + live web search**, with structured
sources added later behind a clean interface. Honesty is achieved by always surfacing
confidence and sources and refusing to invent data — not by pretending to have an
authoritative feed.

Methodology borrowed from the research: normalize all critic scales to 100-pt; treat
critic scores as the "cellar/invest" signal and Vivino as the "drink-now" signal;
compute value-for-money via a transparent QPR formula `(score ÷ price) + bonus → 1–10`.

## Architecture (Approach C — Hybrid)

Node/TypeScript bot using **grammy + Anthropic SDK**, matching the existing
`01_agents/bot/` (Chip & Dale) and `01_agents/barrymore/` patterns. Deploys to Railway
on push to `main`. Own BotFather token.

**Production web search:** the bot runs standalone on Railway, so the harness `WebSearch`
tool is unavailable. Live search is done via the **Anthropic Messages API server-side web
search tool** (Claude searches the web during generation). To be confirmed against the
`claude-api` skill during planning.

### Components (each one clear purpose)

1. **Telegram I/O** (grammy) — receive photo/text/voice, detect reply language from the
   user's message, render short verdict + "Подробнее" inline button, manage sessions.
2. **Input normalization** — photo → base64 (Claude vision); voice → Whisper (reuse the
   `barrymore/src/voice.ts` pattern); text passes through. Produces a unified wine query.
3. **Wine identification** — Claude vision reads the label →
   `{ producer, name, vintage, region, grape, type, confidence }`. Text is parsed to the
   same shape.
4. **`WineDataSource` interface (the seam)** — returns normalized `WineEvidence`:
   `{ criticScores[] (normalized →100), communityRating, priceObservations[],
   tastingNotes, drinkingWindow, sources[] }`.
   - **MVP implementation:** `WebSearchSource` (Claude + server-side web search).
   - **Future adapters (no rewrite):** `VivinoSource` (calls the existing price-service
     `GET /api/public/vivino/lookup`), `LwinSource` (local cache), `LivexSource` (paid).
5. **Assessment engine** — normalize scales to 100 (20×5, stars→100, Bayesian
   quantity-weighting à la Wine-Searcher) → critic consensus → **QPR verdict**
   (`score ÷ price + bonus → 1–10`), weighted by use-case (critics = cellar/invest,
   Vivino = drink-now).
6. **Response formatter** — short verdict (3–4 lines + bottom line: take / skip /
   overpriced) → "Подробнее" inline button expands the full card. Reply language per
   message.
7. **Analogues engine** — for an identified wine, Claude + web search proposes globally
   available analogues by style/level/price with reasoning. Same `WineDataSource` seam.

### Orchestration & data flow

A single **Claude agentic loop with tools** (like `bot/src/tools.ts`), not a rigid
router. Tools: `identify_wine_from_image`, `gather_wine_evidence` (the `WineDataSource`),
`find_analogues`. Claude decides what to call and supports multi-turn follow-ups.

```
message → normalize input → [Claude loop: identify → gather_evidence(web) → assess]
        → short verdict → [Подробнее] → full card
```

### Honesty mechanism (the heart)

Not separate code — an **output contract + system prompt**:
- No praise by default; explicitly name mediocre and overpriced wines.
- Separate "critics" from "crowd" signal.
- Always show **confidence level and sources**.
- When data is thin, say "reliable data is limited" rather than inventing.
- Low confidence is flagged, never masked.

The integration tests assert these constraints (confidence present, sources present, no
fabrication on empty evidence).

## Error handling

- Wine not identifiable from photo → ask for a clearer photo or the name as text.
- Thin evidence → honest low-confidence answer, no fabrication.
- Web search fails / rate-limited → degrade gracefully: return what exists + flag it.
- Whisper fails to transcribe → ask the user to retype.

## Testing (TDD)

- **Unit:** scale normalization (20→100, stars→100), QPR formula, evidence merging,
  language detection.
- **Integration:** mock `WineDataSource` → assert verdict structure and honesty
  constraints (confidence + sources present; no fabrication on empty evidence).
- **Eval set:** 3–4 reference wines (great-value / overpriced / obscure-with-no-data) →
  snapshot the verdict shape.

## Decisions

- **Approach:** C (Hybrid) — LLM + web search now, behind `WineDataSource` for future
  structured sources.
- **Name/persona:** Алан. Folder `01_agents/alan/`.
- **Memory:** in-memory sessions with TTL for MVP (like `bot/`), not Supabase persistence.
- **Deployment:** Railway, own BotFather token. Env reuses repo `.env.local`:
  new `ALAN_BOT_TOKEN`, plus existing `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Whisper).

## Out of scope (MVP)

- Paid Liv-ex APIs and any Vivino scraping (deferred adapters only).
- Catalogue/stock integration — the assistant is general, not tied to W&W inventory.
- Public/customer access — staff-only for now.

## Open items for implementation planning

- Confirm the Anthropic server-side web search tool name/usage via the `claude-api` skill.
- Decide the eval-set wines and expected verdict snapshots.
