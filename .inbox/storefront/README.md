# Storefront ↔ Vivino-API integration kit

Готовые артефакты для интеграции витрины (`phuket-sip-reserve`, Lovable) с публичным
Vivino-API из `price-service`. Скопируй в репо витрины как описано ниже.

## API контракт (`price-service`)

```
GET https://price-service.up.railway.app/api/public/vivino/lookup
    ?name=<wine name>
    [&winery=<winery>]
    [&year=YYYY]
Headers:
    x-api-key: <STOREFRONT_API_KEY>

200 hit:
{
  "match": {
    "rating": 4.3, "reviews_count": 391,
    "image_url": "https://...",
    "country": "New Zealand", "grape": "Sauvignon Blanc 100%",
    "description": "...", "wine_type": "white", "year": 2023,
    "alcohol": null, "body": "medium",
    "flavors": ["citrus", "..."],
    "food_pairings": ["Shellfish", "..."],
    "region": "Marlborough",
    "vivino_url": "https://vivino.com/..."
  },
  "confidence": 1.0
}

200 miss: { "match": null, "reason": "low_confidence" | "no_candidates" | "no_significant_tokens", "topScore": 0.42 }
401 missing/bad x-api-key
400 missing name
503 STOREFRONT_API_KEY not set on server
```

CORS открыт для `*.lovable.app`, `*.lovableproject.com`, `localhost`.
Прод-домен витрины надо будет добавить в env `STOREFRONT_ALLOWED_ORIGINS` на Railway price-service.

## Что положить в репо витрины

1. **`supabase/migrations/<ts>_products_vivino_columns.sql`** — миграция, добавляет колонки в `products`
   (если ещё нет). См. `migration_products_vivino.sql`.
2. **`supabase/functions/enrich-products-vivino/index.ts`** — Deno edge function. См. `edge-function-template.ts`.
3. В Lovable Cloud → Edge functions → задать env:
   - `VIVINO_LOOKUP_URL=https://price-service.up.railway.app/api/public/vivino/lookup`
   - `VIVINO_LOOKUP_KEY=<тот же STOREFRONT_API_KEY что на Railway price-service>`
   (`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Lovable обычно проставляет автоматически.)

## Когда вызывать

Вариант А: после Loyverse-sync (внутри той же edge function) — обогащаем только что появившиеся/обновлённые товары.
Вариант Б: cron / расписание на ежедневный прогон по `products` без `vivino_enriched_at`.

Edge function идемпотентна и пропускает уже обогащённые недавно (TTL 30 дней).

## Замечания

- `vivino_year` (год бутылки по версии Vivino) и собственный `year` могут расходиться. Витрина — single source of truth по году бутылки (он берётся из имени Loyverse), Vivino-год записываем рядом.
- `confidence < 0.5` → API сам вернёт `match: null`. Если хочется записать "не нашли" чтобы повторно не дёргать — пиши `vivino_lookup_attempted_at` без других полей.
- Картинку с Vivino кладём в `vivino_image_url`. Основная картинка товара (`image_url` / `external_product_images`) остаётся как есть — там у вас уже свой пайплайн.
