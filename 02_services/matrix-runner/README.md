# matrix-runner

Webhook-сервис для запуска матрицы закупа из меню Google Sheets.

## Как это работает

```
Google Sheet ──menu click──▶ Apps Script ──HTTPS POST /run──▶ Railway service ──in-process call──▶ runMatrix() ──writes──▶ Google Sheet
```

Apps Script передаёт в заголовке `x-webhook-secret`. Сервис проверяет его против `WEBHOOK_SECRET` в env, и если совпадает — импортирует и вызывает `runMatrix()` из локального `matrix.ts`. Console-вывод перехватывается и возвращается в JSON, Apps Script показывает сводку в alert.

Сервис **самодостаточен** — `matrix.ts` и `wine_detect.ts` лежат рядом с `server.ts`, никаких импортов из родительских директорий нет. Это позволяет деплоить с Railway Root Directory = `02_services/matrix-runner`.

> ⚠️ `matrix.ts` и `wine_detect.ts` — копии файлов из `03_automation/`. При изменении логики синхронизируй обе копии (или просто перекопируй файлы и закоммить).

## Что задеплоить на Railway

В Railway создай **новый сервис** в том же проекте, что и `price-service`:

1. **Source:** тот же GitHub репо (`rasputinpavel/wineandwhiskey`)
2. **Root Directory:** `02_services/matrix-runner` (Settings → Service → Root Directory)
3. **Build:** автоматически — `nixpacks.toml` в этом каталоге уже настроен
4. **Environment Variables** (Settings → Variables, добавить все):

| Переменная | Значение |
|---|---|
| `WEBHOOK_SECRET` | сгенерируй случайную строку, например `openssl rand -hex 24` |
| `LOYVERSE_API_TOKEN` | тот же токен, что в локальном `.env.local` |
| `GOOGLE_CLIENT_ID` | ↑ |
| `GOOGLE_CLIENT_SECRET` | ↑ |
| `GOOGLE_REFRESH_TOKEN` | ↑ |
| `SUPABASE_URL` | ↑ |
| `SUPABASE_SERVICE_KEY` | ↑ |

5. **Generate Domain** в Settings → Networking (Public Networking → Generate Domain). Получишь URL вида `https://matrix-runner-production.up.railway.app`.

6. После деплоя проверь `https://<host>/api/health` — должно вернуть `{"ok":true}`.

## Как подключить к Google Sheets

1. Открой таблицу.
2. Меню → **Extensions → Apps Script**.
3. Удали дефолтный код, вставь содержимое [`apps-script.gs`](./apps-script.gs).
4. Слева в Apps Script: **Project Settings (шестерёнка) → Script Properties → Add property**:
   - `WEBHOOK_URL` = `https://<твой-railway-host>/run`
   - `WEBHOOK_SECRET` = тот же секрет, что в env Railway
5. **Save**, закрой Apps Script.
6. Перезагрузи таблицу. В строке меню появится **Закупка → Пересчитать матрицу**.

При первом запуске Google спросит разрешение на UrlFetchApp — соглашайся.

## Локальная отладка

```bash
cd 02_services/matrix-runner
npm install
WEBHOOK_SECRET=test PORT=3092 npx tsx server.ts
# в другом терминале:
curl -X POST localhost:3092/run -H "x-webhook-secret: test"
```

Сервис автоматически подцепит `.env.local` из корня репо (Loyverse / Google / Supabase токены).

## Время выполнения

Матрица сейчас собирается ~3-4 минуты (Loyverse API + 300 запросов к Supabase).
Apps Script ждёт ответ до 6 минут (лимит `UrlFetchApp.fetch`). Если упрёмся — можно
переключить на async-режим: возвращать сразу `202` с `job_id`, Apps Script будет
поллить `/status/<id>`. Пока не нужно.
