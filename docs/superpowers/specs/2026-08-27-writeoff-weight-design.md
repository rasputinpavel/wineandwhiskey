# Вес в списаниях (весовые товары) — дизайн

**Дата:** 2026-08-27
**Статус:** согласовано, готово к плану
**Автор:** Pavel + Claude
**Расширяет:** [[../specs/2026-08-21-stock-writeoffs-design.md]] (трекер списаний «себе»)

## Проблема

Списания сейчас пишут `qty` в штуках. Но часть ассортимента — еда с весом:

- **Весовые (`sold_by_weight=true` в Loyverse)** — колбасы (Merguez, Vienna, Swiss Cervelas…), некоторые сыры (Brie de Meaux, Gorgonzola Doux). Веса в названии нет, цена за кг. «1 шт» бессмысленно — нужно знать, **сколько грамм** взяли.
- **Сыры-пакеты (`sold_by_weight=false`, вес в названии)** — каждый пакет заведён отдельным SKU: «135g / 146g / 155g / 160g / 184g Gruyere Reserve 10 Months». Для одного сыра — десяток SKU, различающихся только весом. Нужно списать **тот самый пакет** (по весу с ценника), а не любой Gruyere.

На ценнике, который сотрудник фотографирует, вес напечатан.

## Принятые решения

| Развилка | Решение |
|----------|---------|
| Охват | Оба типа (весовые + сыры-пакеты) |
| Источник веса | С этикетки на фото (vision); не распознан / ввод текстом — бот спросит |
| Единицы | **Граммы** (в то-ду человеку дублируем кг для Loyverse) |
| Куда | Прямо в `main` (авто-деплой), миграция `041` вручную |

## Как это работает

Тип определяем по флагу Loyverse **`sold_by_weight`** (есть в `/items`).

### A. Весовой товар (`sold_by_weight=true`) → пишем граммы
1. Фото ценника «Merguez … 250 g» (или текст «спиши мергез 250г») → vision/парсер достаёт `{query:"Merguez", weightGrams:250}`.
2. Матч по каталогу → «Merguez Sausage 100% Pork 7"» (weight-товар).
3. Вес известен → карточка «Merguez Sausage — ⚖️ 250 г». Вес неизвестен → бот спрашивает «Сколько грамм для Merguez Sausage?», следующий числовой ответ достраивает карточку.
4. Запись: `weight_grams=250`, `qty=1`. То-ду человеку: «списать 0.25 кг».

### B. Сыр-пакет (`sold_by_weight=false`, вес в названии) → нужный SKU
1. Фото пакета «Gruyere … 146g» → `{query:"Gruyere Reserve 10 Months", weightGrams:146}`.
2. Вес добавляется в поисковый запрос → SKU «146g Gruyere Reserve 10 Months» ранжируется первым. Точное совпадение веса в названии → сразу карточка; иначе пикер с нужным сверху.
3. Запись: обычная, `qty=1`, `weight_grams=null` (вес уже в `item_name`).

## Компоненты (что меняется)

Все файлы — существующие из трекера списаний.

### 1. `01_agents/bot/src/loyverse.ts` — `getCatalogItems`
Добавить в возвращаемую строку поле `sold_by_weight: boolean` (из `item.sold_by_weight`). Тип `CatalogRow` расширяется. Кэш (60с) не трогаем.

### 2. `01_agents/bot/src/writeoff-parse.ts` (чистая логика, тесты)
- `WriteoffExtraction` += `weightGrams: number | null`.
- `CatalogItem` / `Candidate` += `sold_by_weight: boolean`.
- `WriteoffCard` += `weightGrams: number | null`.
- `PendingRow` += `weight_grams: number | null`.
- `parseWriteoffJSON` читает `weight_grams` (целые граммы >0, иначе null).
- `scoreCandidates` — без изменений в логике; вызывающий добавляет вес в query-строку (`"<query> <weightGrams>g"`), чтобы весовой токен матчил SKU. `sold_by_weight` просто протаскивается в кандидата.
- `buildWriteoffMessage`: если `weightGrams` — строка «⚖️ <b>Вес:</b> 250 г» вместо «🔢 <b>Кол-во:</b>». `parseWriteoffFromMessage` — round-trip веса (парсит обратно и вес, и qty).
- `buildCandidatesKeyboard` — callback теперь несёт вес: `wo_pick:<qty>:<grams|->:<variant_id>` (грамм нет → `-`). ≤64 байт (≈50 для UUID).
- `formatPendingReminder`: строка «• <weight|qty> Название — возраст», где для весовых «250 г», иначе «2×».
- `ageLabel` — без изменений.

### 3. `01_agents/bot/src/writeoff.ts` (побочка)
- `parseWriteoffText` / `parseWriteoffPhoto` — промпты просят вернуть `weight_grams` (с ценника / из текста при явной единице «г/g/грамм»); голое малое число трактуем как qty, не вес.
- `matchCatalog(query, weightGrams?)` — строит эффективный запрос с весом, возвращает кандидатов (со `sold_by_weight`).
- `insertWriteoff` — пишет `weight_grams` (или null).
- `listPending` select += `weight_grams`.

### 4. `01_agents/bot/src/index.ts` (проводка)
- После выбора товара (уверенный матч в `startWriteoffFlow` или `wo_pick`): если `sold_by_weight===true` и вес неизвестен → спросить граммы. Состояние — in-memory `pendingWeight: Map<chatId, {variantId, itemName}>` (как существующие `pendingPhotos`/`pendingExpenses`; рестарт Railway редок, пользователь переотправит).
- В `message:text`: проверка `pendingWeight` в начале — числовой ответ достраивает карточку весового товара; не число → «нужно число грамм».
- `wo_pick` парсит qty+grams+variantId; ветвление по `sold_by_weight`.
- `/writeoffs`: строка показывает «250 г» для весовых, иначе «N×».

### 5. `02_services/mission-control` (портал)
- Миграция `041_writeoff_weight.sql`: `alter table public.stock_writeoffs add column weight_grams integer;`
- `app/api/m/writeoffs/route.ts` GET select += `weight_grams`.
- `app/(portal)/m/writeoffs/page.tsx`: колонка Qty показывает «250 г» когда `weight_grams` задан, иначе число штук.

## Крайние случаи

- **Число как qty vs вес**: «спиши 2 просекко» → qty=2 (не 2 г). «спиши мергез 250г» → weightGrams=250. Различаем по явной единице и величине — промпт инструктирует.
- **Весовой товар, вес не распознан и не введён**: бот спрашивает; пока ждём — `pendingWeight`.
- **Сыр, точного веса-SKU нет** (ценник 147g, а SKU 146g/148g): пикер с ближайшими, пользователь выбирает.
- **callback_data ≤64 байт**: `wo_pick:1:250:<uuid>` ≈ 50 байт — ок.

## Вне scope

- Мульти-пакет за один ввод (несколько весов сразу).
- Перевод сыров-пакетов на настоящий вес-учёт Loyverse.
- Авто-запись Stock Adjustment в Loyverse (по-прежнему руками).
- Дробные граммы / кг-ввод (вводим целые граммы).

## Тестирование

Чистая логика (`writeoff-parse.ts`) — vitest, как в трекере: парс `weight_grams`, round-trip карточки с весом, `formatPendingReminder` с весом, `buildCandidatesKeyboard` с граммами в callback. Проводку и портал — `tsc --noEmit` + ручной смок в боте.
