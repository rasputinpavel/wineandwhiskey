# Бухгалтерский ежемесячный отчёт

**Скрипт:** `03_automation/sync_accounting.ts`
**Запуск:** `npm run accounting -- --month YYYY-MM`
**Drive-папка:** [Accounting](https://drive.google.com/drive/u/5/folders/1afS7_bS-IKkBdfOjEHCLz7SRIoW8lD8N)
**Файл за месяц:** `Accounting YYYY-MM <Mon>` (например, `Accounting 2026-04 Apr`)

---

## Что делает скрипт

Один Google Sheet на месяц с **четырьмя листами**:

### 1. `Sales`
Выручка по дням, разбитая на B2C и B2B (для тайских бухгалтеров — англ. шапка).

- Источник: Loyverse `/receipts` (SALE + REFUND, фильтрация по `receipt_type` на клиенте — серверный фильтр Loyverse игнорируется).
- Окно: `YYYY-MM-01 00:00 +07` → `последний день месяца 23:59 +07` (Bangkok).
- **B2B-классификация (строгая, бухгалтерская):** sale считается B2B только если оплачен `Bank Transfer`. Customer-name match без bank-transfer → B2C (walk-in покупатель с B2B-именем, заплативший картой/налом).
- Возвраты вычитаются из выручки, счётчики не уменьшают.
- Per-receipt overrides — `08_config/b2b_overrides.json`:
  - `force_b2c_receipts` — конкретный bank-transfer чек переводим в B2C (например, B2B-клиент пришёл сам, забрал с полки, заплатил банковской картой через Loyverse, но ни один tax invoice в Flow не выписан).
- Колонки: Date · B2C revenue ฿ · B2B revenue ฿ · Total ฿. Внизу — TOTAL.

### 2. `Tax Invoices`
Выставленные нами счета клиентам — полностью авто через Playwright.

- **Источник:** `advance.flowaccount.com` (workspace `N7474669`), вкладки «ใบกำกับภาษี» (Tax Invoices) и «ใบเสร็จรับเงิน» (Receipts).
- **Реализация:** `lib/flow.ts` (Playwright). Двухстадийный логин (flowaccount → tenant OIDC → SelectCompany), сессия кешируется в `.flow-session.json`.
- **Колонки A–H:** Tax Invoice # · Issue date · Client · Amount ฿ · Status (Paid/Unpaid/Overdue/Cancelled) · Payment date · Receipt # · Note.
- **Conditional formatting:** строки со статусом `Unpaid` или `Overdue` подсвечиваются светло-оранжевым.
- **Логика мэтчинга invoice ↔ receipt:** ищем FlowAccount receipt с тем же `client + amount` (±1 ฿). Если найден — `Paid` + receipt #/date.
- **Section «Receipts received this month for prior invoices»** — apr-receipts которые не сматчились с apr-invoices (= оплаты по предыдущим месяцам). В Note подставляется referenced INV из popover'а на list-странице (без click-through).
- **Section «Reconciliation»:** Loyverse B2B revenue vs FlowAccount receipts. Эта проверка должна сходиться (см. ниже про работу с расхождениями).
- Phantom Flow receipts — `08_config/b2b_overrides.json` секция `exclude_flow_receipts`. Используется когда бухгалтер выписал в Flow receipt-«напоминалку» по старому долгу, но реальных денег не пришло. Такие receipts исключаются из reconciliation, чтобы не давать ложного расхождения.

**Требования:** `FLOW_EMAIL` / `FLOW_PASSWORD` в `.env.local`. Playwright уже в зависимостях. 2FA в FlowAccount отключена.

### 3. `Expenses`
Все purchase orders со статусом `Closed` за месяц — Net / VAT / Total.

- Источник: Supabase `purchase_orders` + `purchase_order_items`. Наполняется `npm run orders` (см. `scrape_purchase_orders.ts`).
- **Net / VAT / Total** берутся из XHR detail каждого PO (`orderData.amount` + `landedCosts`):
  - Net = subtotal после PO-level скидки (orderData.amount + сумма отрицательных landedCosts ÷ 100)
  - VAT = сумма положительных landedCosts ÷ 100
  - Total = Net + VAT (= ยอดรวมสุทธิ на list-странице Loyverse)
- Поля `subtotal_thb` / `vat_thb` / `total_thb` хранятся в `purchase_orders` (миграция: `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal_thb numeric, ADD COLUMN IF NOT EXISTS vat_thb numeric;`).
- Self-heal: для PO со старого scrape (когда колонки в DB сдвинуты из-за бага парсера list-страницы) скрипт восстанавливает `status='Closed'` из items, если `received='Closed'` и `total_thb` null.
- Колонки: # · PO · Order date · Supplier · Net ฿ · VAT ฿ · Total ฿. Внизу — TOTAL.

### 4. `Bonuses`
Расчёт премий менеджерам по B2C.

- **Источник графика:** `08_config/manager_schedules/YYYY-MM.json` (см. `2026-04.json` как образец). Там вручную атрибутирована дневная B2C-выручка по менеджерам — пока в Loyverse один общий аккаунт. Когда у каждого менеджера будет свой Loyverse pos_device, можно перейти на авто-выгрузку.
- **Editable cells (жёлтые):**
  - `Commission %` — процент премии per-manager (PERCENT format, `0.5%` → `0.005`).
  - `Fix ฿` — фиксированный оклад per-manager.
  - **Persistence:** при следующем запуске скрипт читает текущие значения из листа и сохраняет их (правки не затираются). Initial values: JSON `commissions` / `fixed`, иначе CLI flag `--commission-pct`, иначе 1% / 0.
- **Computed cells (зелёные):**
  - `Bonus ฿` = `=TOTAL × Commission%` per manager + `=SUM(...)` итог
  - `Total payout ฿` = `=Fix + Bonus` per manager + итог
- Half-days (когда оба менеджера работали) — атрибуция в JSON `_note`.

---

## Регулярный месячный workflow

```bash
# 1. Подтянуть свежие POs с Loyverse (источник для Expenses)
npm run orders

# 2. Подготовить график менеджеров
cp 08_config/manager_schedules/{prev-month}.json 08_config/manager_schedules/YYYY-MM.json
# Отредактировать days по картинке-расписанию от менеджера-супервайзера, обновить commissions/fixed если изменились

# 3. Сгенерировать отчёт
npm run accounting -- --month YYYY-MM
```

Если результат запуска показал `diff != 0 ฿` в Reconciliation — см. раздел ниже.

**Env-флаги для отладки FlowAccount/Loyverse скрейперов:**
- `FLOW_HEADFUL=1 npm run accounting -- --month YYYY-MM` — видимый браузер для FlowAccount
- `FLOW_DEBUG=1 ...` — скриншоты при ошибках
- `SCRAPER_HEADFUL=1 npm run orders` — видимый браузер для Loyverse PO scraper

---

## Reconciliation: что делать при расхождении Sales vs Tax Invoices

В конце вкладки `Tax Invoices` есть блок **«Reconciliation: Loyverse B2B vs FlowAccount receipts»**. Three rows:

| Source | Amount ฿ | Note |
|---|---|---|
| Loyverse B2B revenue | ... | from Sales tab |
| FlowAccount receipts | ... | N receipts in YYYY-MM |
| **Difference** | **0.00 ฿ ✓ OK** *(зелёный)* / **X.XX ฿ ⚠ Investigate** *(оранжевый)* |

Каждый Loyverse bank-transfer SALE = один FlowAccount receipt. Эти два числа должны совпадать. Если есть расхождение — выясняем что не так.

**Что делает скрипт:** при `diff != 0` в console (НЕ в листе — для бухгалтерии не показывается) печатается список конкретных несовпадений:
- `Loyverse only: <date> <receipt#> <amount> — <client>` → bank-transfer SALE в Loyverse есть, FlowAccount receipt отсутствует
- `FlowAccount only: <date> <receipt#> <amount> — <client>` → FlowAccount receipt есть, Loyverse bank-transfer SALE на эту сумму нет

**Что делать (decision tree):**

1. **Loyverse only** → банк уже зачислил, но receipt в FlowAccount не выписан:
   - 1a. Если это нормальная B2B-сделка — попросить бухгалтера выписать receipt в Flow по соответствующему tax invoice. После этого re-run `npm run accounting`.
   - 1b. Если это walk-in B2B-клиент, заплативший своей корпоративной картой через Loyverse (ни один tax invoice в Flow не будет выписан, потому что они забрали товар сразу) — добавить receipt_number в `08_config/b2b_overrides.json` секцию `force_b2c_receipts` с reason. Сумма перейдёт из B2B-выручки в B2C.

2. **FlowAccount only** → receipt в Flow есть, банк ничего не присылал:
   - 2a. Если это phantom-«напоминалка о долге» (бухгалтер выписал receipt по старому tax invoice'у только чтобы пометить долг закрытым / напомнить о нём) — добавить receipt_number в `08_config/b2b_overrides.json` секцию `exclude_flow_receipts` с reason. Receipt исчезнет из reconciliation.
   - 2b. Если это реальный приход, но он пришёл в другом месяце (например, банк прислал 30-го прошлого месяца, бухгалтер выписал receipt 1-го этого) — оставляем как есть, разница уйдёт через месяц в обратную сторону. Можно пометить в Note.
   - 2c. Если это ошибочно выписанный receipt (без оплаты вообще) — попросить бухгалтера удалить из Flow. После этого re-run.

3. **Reconciliation сошлась после правок** — `diff = 0.00 ฿`, ячейка зелёная. Отчёт можно сдавать.

**Per-month workflow при diff != 0:** запустить раз → посмотреть console mismatches → решить по каждому → отредактировать `b2b_overrides.json` (если применимо) или попросить бухгалтера → re-run accounting → проверить что diff = 0 → сдать отчёт.

---

## Технические детали

- **OAuth scopes:** `spreadsheets` + `drive.file`. Drive API + Sheets API включены в GCP project `259600343740`.
- **Drive поиск:** `drive.file` видит только файлы, созданные/тронутые этим приложением. Удалили файл вручную в Drive → при следующем запуске создастся новый.
- **Sheet1 cleanup:** spreadsheet'ы создаются с дефолтным `Sheet1`, скрипт удаляет в конце.
- **Conditional formats cleanup:** перед добавлением правил в Tax Invoices скрипт удаляет все existing — иначе при многократных запусках они накапливаются и Sheets начинает странно рендерить (клетки кажутся пустыми).
- **Часовой пояс:** Bangkok (UTC+7) по всему скрипту. PO дата в Loyverse list-странице = UTC дата, преобразуется в Bangkok-local при scrape (`bkkDate(poDateTS)`).
- **Refund handling:** `receipt_type=REFUND` в URL Loyverse игнорирует — фильтрую client-side после fetch.
- **FlowAccount pagination:** `a[aria-label="go to next page"]` (ngx-datatable, отличается от Loyverse `a.datatable-icon-right`).

---

## Backlog / nice-to-have

- **Партиальные оплаты** tax invoice'а (сейчас матчится только полная сумма; пока не было нужно).
- **VAT split** B2B/B2C — если бухгалтерия попросит.
- **Cashflow выгрузка** — лист с приходами/расходами по датам.
- **Расширенный мэтчинг stray receipts** — тянуть invoices из предыдущих 60 дней и подставлять конкретный INV номер в Note (сейчас вытягивается из popover'а — обычно работает, но не для всех клиентов).
- **Авто-разбивка по менеджерам** — когда у каждого свой Loyverse pos_device, перейти с manual JSON-расписания на авто-выгрузку из Loyverse `pos_device_id` или `cashier_id`.
- **Починить scrape_purchase_orders.ts** — старая баг-история про сдвиг колонок и timezone shift зафиксирована в коде, новые scrape'ы корректные.
