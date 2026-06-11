# Обязательные расходы (Fixed Costs) — датированная модель план/факт

**Дата:** 2026-06-11
**Сервис:** `02_services/mission-control`
**Статус:** дизайн согласован, спека на ревью

## Проблема

Сейчас «Monthly fixed costs» (в настройках Pulse) — это **месячная сумма без дат**.
Rolling размазывает её ровным дневным темпом:
`baseMonthly ÷ 30.4 × дней_в_неделе`. С ฿93K/мес это ~฿3 058/день → ~฿21.4K на любую
неделю (+ %-строки на прогнозную выручку ≈ ฿22.5K в подсказке). Поэтому аренда (15-е,
฿38K) и utilities (฿12K) никогда не попадают на свои реальные даты — они одинаково
размазаны по всем неделям, и недельные closing-балансы недостоверны.

## Цель

Заменить недатированную месячную сумму на **модель датированных обязательств**: у каждого
регулярного расхода есть день-в-месяце и плановая сумма → генерируются конкретные
датированные события. Эти события — **единый источник правды**, который потребляют Rolling,
Payment Calendar и месячный P&L (Pulse). Плюс трекинг **факта** (что реально оплачено).

## Три непересекающихся ведра

- **Обязательные (Mandatory)** — этот трекер (аренда, зарплата, налоги, utilities, бухгалтерия…).
- **Кредиторка (Payables)** — PO поставщиков (логика не меняется).
- **Операционные (Operational)** — всё остальное из листа Expenses (только факт, не прогнозируем).

Вёдра не пересекаются → двойного счёта нет. Классификация факта: строка листа Expenses
относится к Обязательным, если её категория совпала с категорией `fixed_cost`; иначе —
Операционные. PO поставщиков ведутся отдельно (`purchase_orders`), в листе Expenses их нет.

## Решения (согласовано с пользователем)

- **Размещение:** новый раздел верхнего уровня в сайдбаре, ярлык **«Fixed Costs»**, рядом с
  Payments. Редактор фикс-затрат **выносим** из настроек Pulse сюда.
- **Связь с Payment Calendar:** обязательства = датированные OUT-события, появляются на
  календаре рядом с PO. Календарь становится полным датированным таймлайном кэшфлоу.
- **%-строки (Налоги 3.5% выручки, Бонусы 1% выручки):** получают `due_day`; план =
  `% × выручка(того же месяца)` — факт для закрытых месяцев, прогноз для текущего/будущих.
  Без сдвига на следующий месяц (не arrears).
- **План→Факт:** авто-матч из листа Expenses по категории, с ручной правкой (override).
- **Операционные в Rolling:** только факт, прогноза нет.
- **Месячный P&L:** факт для закрытых месяцев, план для текущего/будущих.
- **Буфер (5% one-offs):** убираем полностью.

## Модель данных

Расширяем существующую `inventory.fixed_cost` (она уже хранит шаблон), новых «шаблонных»
таблиц не плодим.

### Миграция `024_mandatory_dates.sql`

```sql
alter table inventory.fixed_cost
  add column if not exists due_day smallint
    check (due_day is null or (due_day >= 1 and due_day <= 31)),
  add column if not exists match_category text;

create table if not exists inventory.mandatory_actual (
  fixed_cost_id  uuid not null references inventory.fixed_cost(id) on delete cascade,
  period         text not null,              -- 'YYYY-MM'
  paid           boolean not null default false,
  amount_thb     numeric,                    -- null → берём сумму из листа Expenses
  paid_at        date,
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (fixed_cost_id, period)
);
```

- `due_day` (1–31, nullable) — день месяца, когда расход к оплате. Аренда=15, Зарплата=3,
  Налоги=10. **Nullable → fallback на старое размазывание** (ничего не ломается, пока дни не
  проставлены).
- `match_category` (nullable) — категория(и) из листа Expenses, которые закрывают это
  обязательство (через запятую, напр. `Rent,Аренда`). Null → матчим по имени категории,
  case-insensitive.
- `mandatory_actual` — строка существует **только** при ручной правке факта. Нет строки →
  факт берётся вживую из листа Expenses.

`pulse_settings.fixed_buffer_pct` остаётся в БД, но **больше не применяется** в расчётах
(буфер убран). Колонку не удаляем — чтобы не ломать другие чтения; помечаем устаревшей.

## lib/mandatory.ts (новый модуль)

Единый дом логики, потребляется Rolling / Pulse / Payment Calendar.

```ts
type FixedCostRow = {
  id: string; category: string;
  amount_thb: number | null; percent_revenue: number | null;
  due_day: number | null; match_category: string | null; active: boolean
}

type Obligation = {
  fixedCostId: string
  category: string
  date: string            // 'YYYY-MM-DD' — M + due_day (clamp на длину месяца)
  planned: number         // фикс amount_thb, либо percent_revenue × revenue(M)
}

type Reconciled = Obligation & {
  actual: number | null   // override.amount_thb ?? сумма листа Expenses по категории ?? null
  paidAt: string | null
  status: 'paid' | 'overdue' | 'pending'
  source: 'override' | 'sheet' | null
}

// Генерация обязательств месяца из шаблона.
// revenueOfMonth(month) → факт для закрытого, прогноз для текущего/будущего.
generateObligations(month: string, rows: FixedCostRow[], revenueOfMonth: (m: string) => number): Obligation[]

// Сверка с фактом. expenses — строки листа Expenses; overrides — mandatory_actual.
reconcile(obs: Obligation[], expenses: WalletExpense[], overrides: MandatoryActual[], today: string): Reconciled[]
```

### Правила сверки (на обязательство)

1. **Override важнее:** есть `mandatory_actual` для (fixed_cost_id, period) →
   `paid` / `amount_thb` / `paid_at` из неё.
2. **Иначе авто-матч листа Expenses:** сумма строк месяца M, у которых `category` совпадает
   с `match_category` (или с именем категории), case-insensitive. Нашли → `status='paid'`,
   `actual` = сумма, `paidAt` = последняя дата.
3. **Иначе не оплачено:** `status='overdue'` если `date < today`, иначе `'pending'`; `actual=null`.

### Клэмп даты

`due_day` больше длины месяца (напр. 31 в феврале) → берём последний день месяца.

## Раздел/страница трекера

Новый раздел верхнего уровня, ярлык «Fixed Costs», путь `app/(portal)/m/fixed-costs/`.
Убираем редактор фикс-затрат из `app/(portal)/m/pulse/settings/`.

Два вида (через `searchParams`):

- **Template** — текущий редактор `fixed_cost` (категория, ฿/% сумма, активность),
  переносим как есть, **добавляем поле `due_day`** и (опционально) `match_category`.
  Это «общий сеттинг месяца».
- **Month** (`?month=YYYY-MM`) — список обязательств месяца после `reconcile`:
  колонки `Срок · Категория · План · Факт · Δ · Статус`. Каждая строка редактируется
  (отметить оплату / поправить сумму/дату) → пишет `mandatory_actual` (override).
  KPI-карточки: План (итог), Факт (итог), Δ, Оплачено/Осталось.

## Rolling

### Изменение `lib/rolling.ts`

Вход `buildRolling`: вместо `fixed: RollingFixed` (размазка `{baseMonthly, pctRate}`) —
`mandatory: DatedAmount[]` (датированные обязательства из шаблона, с уже вычисленными
суммами; %-строки посчитаны через `revenueOfMonth`). Также передаём признак категории для
разбивки факта (или отдельный сет «мандаторных категорий» для классификации `expensesActual`).

По неделям:

- **Прогнозные недели** (`forecast`/`current`, proj-сторона):
  `outflow = mandatoryProj + apProj`
  где `mandatoryProj` = Σ обязательств с датой в неделе. **Без размазки, без буфера,
  операционные не прогнозируем.**
- **Закрытые недели** (`closed`): `outflow = expAct + outAct` как сейчас (сохраняет сверку
  «на сегодня»). Для **разбивки** сумму листа делим по категориям:
  - Обязательные-факт = строки Expenses недели, чья категория ∈ мандаторных категорий.
  - Операционные-факт = остальные строки Expenses недели.

`outflowNote` / разбивка возвращаются структурно (а не только строкой), чтобы UI отрисовал
постоянную строку-разбивку.

### Отображение (страница rolling)

Колонка Outflow остаётся суммой + постоянная строка-разбивка под числом:

```
прогноз:  Обязательные ฿50,000 · Кредиторка ฿10,302
закрыто:  Обязательные ฿38,000 · Операционные ฿14,562
```

Так Jun 15–21 покажет Аренду ฿38K + Utilities ฿12K именно этой неделей (≈฿50K Обязательные),
а не размазанные ฿22K. (Решено: строка-разбивка, **не** три отдельные колонки — таблица и так
в 6 колонок.)

## Payment Calendar

В `payment-calendar/page.tsx` генерируем обязательства релевантного месяца (или открытых) и
добавляем как OUT-`CalEvent`:
- `date` = срок, `dir='out'`, `who` = категория, `label` = «Fixed»,
- `amount` = план (или факт после оплаты),
- `status` из `reconcile` (`paid`/`overdue`/`pending`/`future`→`pending`).

Неттятся с PO и инвойсами → полный датированный таймлайн. Двойного счёта нет (Обязательные,
Кредиторка-PO, IN-инвойсы не пересекаются).

## Pulse / месячный P&L

В `pulse/page.tsx`:
- **Обязательные:** закрытые месяцы → реальный факт (Σ `reconcile.actual`); текущий →
  факт-на-сегодня + план по оставшимся обязательствам; будущие → план-шаблон.
- **Буфер:** убрать из расчёта `fixed`.
- **Операционные:** отдельной строкой в Net по факту (немандаторные расходы листа Expenses)
  для закрытых/текущего месяца; будущее не прогнозируем.

Эффект: исторический Net слегка опускается (ближе к правде, перестаёт молча игнорировать
операционку), мандаторка по закрытым месяцам перестаёт быть оценкой.

## Файлы

- `supabase/migrations/024_mandatory_dates.sql` — `fixed_cost` + `due_day`, `match_category`;
  таблица `mandatory_actual`.
- `lib/mandatory.ts` (новый) — `generateObligations`, `reconcile`, типы.
- `app/(portal)/m/fixed-costs/` (новый раздел) — виды Template + Month.
- `app/api/m/mandatory-actual/route.ts` (новый) — CRUD override-строк.
- `app/api/m/fixed-costs/route.ts` — добавить запись `due_day` / `match_category`.
- `lib/rolling.ts` + `app/(portal)/m/rolling/page.tsx` + `components/modules/rolling/RollingClient.tsx`
  — датированные обязательные + структурная разбивка по вёдрам.
- `app/(portal)/m/payment-calendar/page.tsx` — обязательные как OUT-события.
- `app/(portal)/m/pulse/page.tsx` — факт/план обязательных, убрать буфер, строка операционных.
- `app/(portal)/m/pulse/settings/page.tsx` — убрать редактор фикс-затрат (переехал).
- `lib/registry.ts` — новый раздел «Fixed Costs», `SectionKey`.

## Фазы (один спек, три отгружаемых плана)

1. **Модель + трекер** — миграция `024`, `lib/mandatory.ts`, раздел Fixed Costs (Template +
   Month), API override. Чинит источник правды; Rolling/Pulse/Calendar пока без изменений
   (fallback на старое размазывание сохраняется, т.к. `due_day` nullable).
2. **Rolling** — датированные обязательные + структурная разбивка по вёдрам. **Чинит баг ฿22K.**
3. **Calendar + Pulse** — обязательные как OUT-события; Pulse факт/план + убрать буфер +
   строка операционных.

## Вне scope

- Сдвиг налогов/бонусов на arrears (платим в след. месяце за текущий) — возможный follow-up.
- Прогноз операционных расходов (run-rate) — намеренно не делаем (только факт).
- Удаление колонки `pulse_settings.fixed_buffer_pct` (оставляем, помечаем устаревшей).
- Изменение логики PO и листа Outstanding.

## Проверка

- `npm run build` в `02_services/mission-control` проходит.
- **Фаза 1:** трекер Month показывает обязательства на своих датах; авто-матч из листа
  Expenses ставит «оплачено»; ручная правка пишет `mandatory_actual` и переопределяет факт.
- **Фаза 2:** Jun 15–21 показывает ≈฿50K Обязательные (Аренда 38K + Utilities 12K) в
  outflow-разбивке, не ฿22K-размазку; закрытые недели бьются с прежней сверкой «на сегодня».
- **Фаза 3:** обязательные стоят на своих датах в Payment Calendar и неттятся с PO; Pulse Net
  по закрытым месяцам считает по факту мандаторки + операционка отдельной строкой, буфера нет.
