# Алан — Wine Assistant Bot

Standalone Telegram bot: a realist sommelier. Send a label photo, a typed name, or
a voice note → honest verdict (what it is, critics vs. crowd, value-for-money,
take/skip). Or ask for global analogues.

## How it works
Approach C (hybrid): `WineDataSource.research()` (Claude Opus 4.8 + server-side web
search) → structured-output extraction of `WineEvidence` → deterministic
normalization (100-pt) + QPR verdict. Honesty is enforced by the system prompt and
output contract — confidence and sources always shown, never fabricated.

## Similar wines ("Похожие у нас")
After a verdict, the **Похожие у нас** button recommends similar wines in three tiers:
in-stock (Loyverse `inventory.v_sku_breakdown`), supplier catalog (`public.wine_items`),
and the world (existing analogues search). Attribute prefilter → LLM re-rank; price
direction and the ровня/дешевле/апгрейд label are computed deterministically in code.
Reads Supabase directly with the bot's existing `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`
(same project as mission-control). Code lives in `src/recommend/`.

## Env (root `.env.local` / Railway)
- `ALAN_BOT_TOKEN` — BotFather token (new bot)
- `ANTHROPIC_API_KEY` — Claude (shared)
- `OPENAI_API_KEY` — Whisper voice transcription (shared)
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — optional; enables the wine cache (apply `migrations/001_wine_cache.sql` in Supabase first). Without them the bot runs fine, just without caching.

## Run
```bash
npm install
npm test       # unit suite
npm run dev    # local (long polling)
```

## Deploy
Railway service, root dir `01_agents/alan`, start `npm start`, deploys on push to `main`.

## Future sources (the seam)
`src/sources/` — add `VivinoSource` (price-service `/api/public/vivino/lookup`),
`LwinSource`, or paid `LivexSource` implementing `WineDataSource`; no pipeline rewrite.
