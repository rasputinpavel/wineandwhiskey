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
- **B2B-классификация (единая, management):** [lib/b2b.ts::classifyReceipt](lib/b2b.ts) — sale считается B2B если оплачен `Bank Transfer` **ИЛИ** customer_name ∈ `B2B_PATTERNS`. Walk-in B2B-клиент, заплативший картой/налом, тоже идёт в B2B. Эту же логику используют Bonuses (премия не считается от B2B-сделок) и CRM.
- Возвраты вычитаются из выручки, счётчики не уменьшают.
- Per-receipt overrides — `08_config/b2b_overrides.json`:
  - `force_b2c_receipts` — конкретный B2B-чек переводим в B2C (если редко-используемое исключение).
- Колонки: Date · B2C revenue ฿ · B2B revenue ฿ · Total ฿. Внизу — TOTAL.

### 2. `Tax Invoices`
Выставленные нами счета клиентам — полностью авто через Playwright.

- **Источник:** `advance.flowaccount.com` (workspace `N7474669`), вкладки «ใบกำกับภาษี» (Tax Invoices) и «ใบเสร็จรับเงิน» (Receipts).
- **Реализация:** `lib/flow.ts` (Playwright). Двухстадийный логин (flowaccount → tenant OIDC → SelectCompany), сессия кешируется в `.flow-session.json`.
- **Колонки A–H:** Tax Invoice # · Issue date · Client · Amount ฿ · Status (Paid/Unpaid/Overdue/Cancelled) · Payment date · Receipt # · Note.
- **Conditional formatting:** строки со статусом `Unpaid` или `Overdue` подсвечиваются светло-оранжевым.
- **Логика мэтчинга invoice ↔ receipt (два прохода, порядок важен):**
  1. **По ссылке.** FlowAccount печатает номер оплачиваемого счёта прямо в строке receipt'а — скрейпер кладёт его в `appliedInvoices`. Эта ссылка авторитетна. Receipt, ссылающийся на счёт не из текущего месяца, резервируется как stray и в первый проход к текущим счетам не допускается.
  2. **По `client + amount` (±1 ฿)** — только для receipt'ов, у которых ссылку выскрести не удалось.
  Почему так: у клиента может висеть два открытых счёта на одинаковую сумму (Milimon, август-2026: `INV202607130001` от 13.07 и `INV202608020001` от 02.08, обе 4,173.00 ฿). Августовская оплата закрывала июльский счёт, а матч по сумме привязал её к августовскому и объявил его оплаченным за две недели до срока.
- **Section «Receipts received this month for prior invoices»** — apr-receipts которые не сматчились с apr-invoices (= оплаты по предыдущим месяцам). В Note подставляется referenced INV из popover'а на list-странице (без click-through).
- **Section «Reconciliation»:** вся Loyverse B2B-выручка (net of refunds, любой способ оплаты) vs FlowAccount receipts. Сходиться должно **в ноль**: бухгалтер выписывает Flow receipt под каждую B2B-продажу, включая оплаченные QR/картой (подтверждено на августе-2026 — 7 Cup Session дважды платил QR, receipts выписаны). Две информационные строки под diff показывают разбивку базы на bank transfer и card/QR.
  - Возвраты вычитаются: если продажу отменили и перебили заново, SALE и REFUND схлопываются друг с другом и в mismatch-лог не попадают (иначе отменённый чек считался бы дважды).
- Phantom Flow receipts — `08_config/b2b_overrides.json` секция `exclude_flow_receipts`. Используется когда бухгалтер выписал в Flow receipt-«напоминалку» по старому долгу, но реальных денег не пришло. Такие receipts исключаются из reconciliation, чтобы не давать ложного расхождения.
- Счета не-B2B контрагентам — `08_config/b2b_overrides.json` секция `exclude_flow_invoices` (`invoice_number` + `receipt_number`). Используется когда бухгалтер выписал tax invoice физлицу (розничная продажа). Такой invoice убирается из листа, а его receipt — из сверки. Первый кейс: август-2026, Sirotinina Elena (10,000) и Vitaliy Den (2,980).

**Требования:** `FLOW_EMAIL` / `FLOW_PASSWORD` в `.env.local`. Playwright уже в зависимостях. 2FA в FlowAccount отключена.

### 3. `Expenses`
Все purchase orders за месяц (любого статуса) — Net / VAT / Total.

- Источник: Supabase `purchase_orders` + `purchase_order_items`. Наполняется `npm run orders` (см. `scrape_purchase_orders.ts`).
- **Net / VAT / Total** берутся из XHR detail каждого PO (`orderData.amount` + `landedCosts`):
  - Net = subtotal после PO-level скидки (orderData.amount + сумма отрицательных landedCosts ÷ 100)
  - VAT = сумма положительных landedCosts ÷ 100
  - Total = Net + VAT (= ยอดรวมสุทธิ на list-странице Loyverse)
- **VAT-inclusive fallback:** если `vat_thb` < 1 ฿ (поставщик не вынес VAT отдельной строкой, а написал «VAT included» в Notes — либо оператор ошибся при вводе), считаем total VAT-инклюзивным: `vat = total × 7/107`, `net = total − vat`. Без VAT PO существовать не может — поставщик-неплательщик у нас не работает.
  - **Порог 1 ฿ (а не 0):** VAT в копейках на заказе в тысячи бат — это опечатка в строке VAT, а не реальная сумма. Август-2026: PO3033 (P-Hops) — оператор вбил 0.08 ฿ вместо 419.44, PO3036 (BB&B) — 0.03 ฿. Total при этом введён верно, поэтому пересчёт из total воспроизводит счёт поставщика точь-в-точь. Такие PO печатаются в консоль отдельным warning'ом — их стоит поправить и в Loyverse.
- Поля `subtotal_thb` / `vat_thb` / `total_thb` хранятся в `purchase_orders` (миграция: `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal_thb numeric, ADD COLUMN IF NOT EXISTS vat_thb numeric;`).
- Self-heal: для PO со старого scrape (когда колонки в DB сдвинуты из-за бага парсера list-страницы) скрипт восстанавливает `status='Closed'` из items, если `received='Closed'` и `total_thb` null.
- **Pending PO тоже расход.** Раньше лист брал только `status='Closed'` и молча терял консигнацию: товар заводят через stock adjustment, а счёт к оплате остаётся PO в статусе Pending (Receive задвоил бы сток). Так выпали Harvest в июле и августе, точечная консигнация Vinum Lector и Cigar Empire. Правило теперь обратное — берём всё, лишнее снимаем вручную. Расход признаём по дате счёта, а не по дате оплаты.
- **PO exclusions:** два способа, оба уважаются:
  - `08_config/po_exclude.json` — список PO, которые не должны попадать в Expenses (например, искусственный PO, созданный в Loyverse для коррекции остатков). Каждая запись: `po_number` + `reason`.
  - `cashflow_override='exclude'` — кнопка «force exclude» в портале (карточка поставщика, платёжный календарь). Тот же смысл, но ставится на месте, без правки файла.
- **Перенос в другой месяц:** `08_config/po_include.json` (`po_number` + `month` + `reason`) — когда счёт выписан не в том месяце, к которому относится расход. Для «вытащить pending» больше не нужен: pending и так входит.
- Колонки: # · PO · Order date · Supplier · Net ฿ · VAT ฿ · Total ฿. Внизу — TOTAL.

### 4. `Bonuses`
Расчёт премий менеджерам по B2C.

- **Источник графика:** `08_config/manager_schedules/YYYY-MM.json`. Генерируется `npm run schedule` (см. ниже) или редактируется вручную.
- **Какой B2C тут считается:** премия = 1% от B2C по **единому правилу** `lib/b2b.ts::classifyReceipt` (тот же, что в Sales tab). B2B-клиент, заплативший картой/налом, исключается из базы бонуса — менеджер не получает % с корпоративной сделки.
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

# 2. Сгенерировать график менеджеров. --som / --grace — дни N. --half поддерживает
#    несколько сегментов через "|" (пример: "3:Grace=11-16,Som=16-22").
#    Скрипт сам пуллит Loyverse, применяет management B2B-классификатор и считает per-day B2C.
npm run schedule -- --month YYYY-MM \
  --som  4,5,8,9,10,11,12,13,20,21,24,25,26,28 \
  --grace 1,2,6,7,14,15,16,17,18,19,22,23,27,29,30 \
  --half "3:Grace=11-16,Som=16-22" \
  --closed 31 --closed-reason "Visakha Bucha Day" \
  --commission Grace=1,Som=1 --fixed Grace=18000,Som=20000

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

В конце вкладки `Tax Invoices` есть блок **«Reconciliation: Loyverse B2B revenue vs FlowAccount receipts»**. Сравнивается вся B2B-выручка за вычетом возвратов — та же цифра, что в итоге листа `Sales`:

| Source | Amount ฿ | Note |
|---|---|---|
| Loyverse B2B revenue (net of refunds) | ... | all B2B sales, any payment method — same figure as the Sales tab |
| FlowAccount receipts | ... | N receipts in YYYY-MM |
| **Difference** | **0.00 ฿ ✓ OK** *(зелёный)* / **X.XX ฿ ⚠ Investigate** *(оранжевый)* |
| — of which paid by bank transfer | ... | informational |
| — of which paid by card / QR | ... | informational |

Каждая B2B-продажа = один FlowAccount receipt, независимо от способа оплаты. Отменённые-и-перебитые продажи схлопываются со своими REFUND. Если не сошлось — выясняем что не так.

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
