# Benz Tracker — Google Sheet Spec

Sheet с двумя вкладками. Создать в Google Drive, расшарить Benz с правом редактирования. Ссылку добавить в [profile.md](profile.md).

**Suggested file name:** `Benz — Sales Tracker (May–Jun 2026)`

---

## Sheet 1 — `Earnings Calculator`

Простая прикидка, сколько Benz может заработать. Жёлтые ячейки — input, остальное формулы.

### Layout

| Cell | Label | Value / Formula |
|------|-------|-----------------|
| A1 | **Trial period** | `2026-05-10 → 2026-06-11` |
| | | |
| A3 | **Per-meeting fee (THB)** | 1000 |
| A4 | **Commission rate (%)** | 10 |
| A5 | **WHT (%)** | 3 |
| | | |
| A7 | _Scenario_ | _Low_ | _Mid_ | _High_ |
| A8 | Number of qualified meetings | 10 | 20 | 30 |
| A9 | Number of accounts that placed first order | 0 | 2 | 5 |
| A10 | Average first order size (THB, net of VAT) | 30000 | 30000 | 30000 |
| | | | | |
| A12 | Meeting fees gross | `=B8*B$3` | (same) | (same) |
| A13 | Commission gross | `=B9*B10*B$4/100` | | |
| A14 | **Subtotal gross (THB)** | `=B12+B13` | | |
| A15 | WHT deduction | `=B14*B$5/100` | | |
| A16 | **Net payout (THB)** | `=B14-B15` | | |

(Колонки B/C/D — Low / Mid / High соответственно. Формулы копируются вправо. Цифры — иллюстративные, не таргеты.)

### Use

Benz открывает, видит три сценария, понимает свою экономику. Никакой магии.

---

## Sheet 2 — `Meetings CRM`

Простая воронка по аккаунтам. Каждая строка = один аккаунт (не каждая встреча — встречи укладываются в notes/последний статус).

### Columns

| Col | Header | Type / Notes |
|-----|--------|--------------|
| A | First meeting date | `YYYY-MM-DD` |
| B | Venue name | text |
| C | Type | dropdown: `Restaurant / Bar / Cafe / Hotel / Other` |
| D | Area | dropdown: `Patong / Kata / Karon / Phuket Town / Rawai / Cherng Talay / Bang Tao / Other` |
| E | Contact name | text |
| F | Contact role | dropdown: `Owner / F&B Manager / Buyer / Manager / Other` |
| G | Phone | text |
| H | LINE / WhatsApp | text |
| I | Status | dropdown: `Lead / Met / Tasting scheduled / Sample sent / Quote sent / Negotiating / Won / Lost / Stalled` |
| J | Next step | text |
| K | Next step date | `YYYY-MM-DD` |
| L | Notes | freeform |
| M | **Qualified meeting** | dropdown: `Y / N` — флаг для оплаты 1000 THB |
| N | First order amount (THB, net of VAT) | number, заполняется когда оплачен |
| O | Order paid date | `YYYY-MM-DD` |
| P | **Commission due (THB)** | `=IF(O>0, N*0.10, 0)` |
| Q | Commission paid date | `YYYY-MM-DD` |

### Summary at top (rows 1-5)

Над таблицей — счётчики (frozen rows 1-5):

- `Qualified meetings count` = `=COUNTIF(M:M, "Y")`
- `Won accounts` = `=COUNTIF(I:I, "Won")`
- `Total commission earned` = `=SUMIF(Q:Q, ">0", P:P)` (только уже выплаченные)
- `Total commission pending` = `=SUMIFS(P:P, O:O, ">0", Q:Q, "")` (оплачено клиентом, но ещё не выплачено Benz)

### Conditional formatting

- Status `Won` → зелёный фон строки
- Status `Lost` → серый фон
- `Next step date` ≤ today и status ≠ `Won/Lost` → красный фон ячейки K (просрочка)

---

## После создания

1. Положить ссылку в `profile.md` → секция Документы.
2. Расшарить Benz (edit access) и Pavel (owner).
3. На первой встрече с Benz — пройтись по обоим листам вместе, чтобы заполнение было привычкой с дня 1.
