# Алан — Wine Assistant Bot

Standalone Telegram bot: a realist sommelier. Send a label photo, a typed name, or
a voice note → honest verdict (what it is, critics vs. crowd, value-for-money,
take/skip). Or ask for global analogues.

## How it works
Approach C (hybrid): `WineDataSource.research()` (Claude Opus 4.8 + server-side web
search) → structured-output extraction of `WineEvidence` → deterministic
normalization (100-pt) + QPR verdict. Honesty is enforced by the system prompt and
output contract — confidence and sources always shown, never fabricated.

## Env (root `.env.local` / Railway)
- `ALAN_BOT_TOKEN` — BotFather token (new bot)
- `ANTHROPIC_API_KEY` — Claude (shared)
- `OPENAI_API_KEY` — Whisper voice transcription (shared)

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
