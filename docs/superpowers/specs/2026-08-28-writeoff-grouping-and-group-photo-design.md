# Группировка напоминалки + групповое фото списаний — дизайн

**Дата:** 2026-08-28
**Статус:** согласовано, готово к плану
**Автор:** Pavel + Claude
**Расширяет:** [[2026-08-21-stock-writeoffs-design.md]], [[2026-08-27-writeoff-weight-design.md]]

## Две доработки трекера списаний

### A. Группировать одинаковые названия в утренней напоминалке
Сейчас `formatPendingReminder` печатает каждую pending-строку отдельной строкой. Если один товар взяли несколько раз (несколько pending-записей с одним `item_name`), они дублируются. Нужно свернуть в одну строку с суммой.

### B. Групповое фото бутылок → распознать и списать все разом
Сейчас на каждую бутылку отдельное фото/ввод. Нужно: одно фото нескольких бутылок → бот распознаёт все → одна сводная карточка → «Записать всё».

Обе — прямо в `main` (авто-деплой). **Миграция не нужна** (вставки используют существующие колонки `stock_writeoffs`).

## A. Группировка (только отображение)

`formatPendingReminder` группирует pending-строки по **точному `item_name`**:
- Штучные (`weight_grams=null`): суммируем `qty` → «3× Prosecco».
- Весовые (`weight_grams` задан): суммируем граммы → «550 г Merguez».
- Возраст группы — по **самой старой** записи (самое срочное).
- Сортировка групп — по старшинству (старые сверху).
- Заголовок «Не списано (N)» — N = число **групп** (совпадает с числом показанных строк).
- Разные веса сыра («146g Gruyere» vs «155g Gruyere») — разные `item_name` → отдельные строки (правильно, это разные SKU).

`/writeoffs` (бот) и портал НЕ меняются — там строки индивидуальные, закрываются по одной. Группировка — исключительно для читаемости напоминания.

Реализация: чистая функция в `writeoff-parse.ts`, unit-тесты.

## B. Групповое фото

### Определение группы — авто, по числу распознанных
Любое фото + триггер «спиши»: vision возвращает **массив** позиций.
- 0 → «не распознал».
- 1 → текущий одиночный флоу (`startWriteoffFlow`).
- >1 → групповой флоу.

### Поток
1. **`parseWriteoffPhotoMulti(base64, mime, caption)`** (в `writeoff.ts`) — vision-промпт просит вернуть JSON-**массив** `[{query, qty, weight_grams?}, …]`, по одной записи на каждую распознанную бутылку/этикетку (qty = число одинаковых). Парсит через новый `parseWriteoffJSONArray`.
2. **Матчинг каждой позиции** (`startGroupWriteoffFlow` в `index.ts`): `matchCatalog(query, weightGrams)`:
   - Уверенный (`isConfident`) штучный (`!sold_by_weight`) матч → в группу `{variantId, itemName, qty}`.
   - Неуверенный / не найден / весовой (в групповом фото граммы не спросить) → в список `unresolved` (по `query`).
   - Позиции, попавшие на один `variant_id`, сливаем (сумма qty).
3. Если уверенных нет → сообщение «не распознал уверенно, заведи по одному» + `unresolved`.
4. Иначе → `pendingGroup.set(chatId, items)` (**in-memory**, как `pendingExpenses`) и сводная карточка:
   ```
   🍷 Списание группой — проверь:
   • 1× Prosecco Miravento DOC
   • 2× Rioja Reserva
   • 1× Beluga
   ⚠️ не распознал уверенно: Chateau X — заведи по одному   (если есть)

   [✅ Записать всё] [✖ Отмена]
   ```
5. **`wo_group_confirm`** → вставить все строки из `pendingGroup` (`insertWriteoff` по каждой, `weightGrams=null`), `pendingGroup.delete`, отредактировать в «✅ Записано: N позиций». **`wo_group_cancel`** → очистить + «✖ Отменено».

### Почему in-memory
Сводная карточка не может нести N `variant_id` (callback ≤64 байта; в тексте variant_id нет). Поэтому список группы держим в памяти `pendingGroup: Map<chatId, {variantId,itemName,qty}[]>`. Рестарт Railway теряет незакрытую группу — редко, пользователь переотправит фото. Согласуется с существующими `pendingPhotos`/`pendingExpenses`.

## Компоненты

### `01_agents/bot/src/writeoff-parse.ts` (чистая логика + тесты)
- `groupPending(rows: PendingRow[]): { item_name, qty, weight_grams, oldest: string, count }[]` — группировка по `item_name` (суммы qty/grams, oldest taken_date). Weight-группа: `weight_grams` = сумма; piece-группа: `weight_grams=null`, `qty`=сумма. `formatPendingReminder` использует её.
- `parseWriteoffJSONArray(raw): WriteoffExtraction[]` — парсит JSON-массив (каждый элемент через ту же логику что `parseWriteoffJSON`; пустой/битый → `[]`).
- `type GroupItem = { variantId: string; itemName: string; qty: number }`.
- `buildGroupMessage(items: GroupItem[], unresolved: string[]): string` — сводная карточка (item_name эскейпится).
- `buildGroupKeyboard(): InlineKeyboard` — `wo_group_confirm` / `wo_group_cancel`.

### `01_agents/bot/src/writeoff.ts` (побочка)
- `parseWriteoffPhotoMulti` — vision, возвращает `WriteoffExtraction[]`.

### `01_agents/bot/src/index.ts` (проводка)
- `pendingGroup` map.
- Фото-хендлеры (captioned trigger + pending-photo follow-up) вызывают `parseWriteoffPhotoMulti` → ветвление 0/1/>1.
- `startGroupWriteoffFlow(chatId, extractions)`.
- `wo_group_confirm` / `wo_group_cancel` в `handleWriteoffCallback`.

## Крайние случаи
- **Группа из одинаковых бутылок**: vision вернёт qty=2 или две записи → сливаем по variant_id.
- **Все неуверенные**: карточки нет, просто список «заведи по одному».
- **Весовой товар в группе**: уходит в `unresolved` (граммы в группе не спрашиваем).
- **Пустой pendingGroup на confirm** (рестарт): «Группа устарела — отправь фото снова».
- Одиночное фото — поведение не меняется (массив длины 1 → старый путь).

## Вне scope
- Пикеры/выбор кандидата внутри группы.
- Редактирование/удаление отдельной позиции в сводной карточке (только «всё» или «отмена»).
- Весовые товары в групповом фото (граммы per-item).
- Группировка в `/writeoffs` и портале (там по-строчно намеренно).

## Тестирование
Чистая логика (`writeoff-parse.ts`) — vitest: `groupPending` (штучные суммы, весовые суммы, oldest, разные имена раздельно), `formatPendingReminder` со сгруппированным выводом, `parseWriteoffJSONArray`, `buildGroupMessage`, `buildGroupKeyboard`. Побочку/проводку — `tsc --noEmit` + ручной смок.
