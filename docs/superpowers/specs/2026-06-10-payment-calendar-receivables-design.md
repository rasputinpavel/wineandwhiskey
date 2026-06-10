# Payment Calendar — двусторонний (кредиторка + дебиторка)

**Дата:** 2026-06-10
**Сервис:** `02_services/mission-control`
**Статус:** дизайн согласован, спека на ревью

## Цель

Сейчас Payment Calendar (`/m/payment-calendar`) показывает только **кредиторку** —
неоплаченные PO, сгруппированные по дате платежа поставщику. Добавляем вторую
сторону: **дебиторку** — ожидаемые поступления от B2B-инвойсов (Invoices Flow,
которые ещё без Receipt и без оплаты). Получаем единый **нетто-таймлайн платежей**:
что мы платим и что нам должны прийти, по датам, с бегущим NET.

Календарь выносим в отдельный раздел верхнего уровня сайдбара — первым после Pulse.

## Решения (согласовано с пользователем)

- **Layout:** один нетто-таймлайн (OUT / IN / бегущий NET), не два отдельных блока.
- **Статус оплаты дебиторки:** автоматически из данных FlowAccount (как на странице
  Outstanding). Никакого ручного редактирования «получено», никаких новых записей в БД.
- **Размещение:** новый раздел верхнего уровня. **Имя пункта остаётся «Payment Calendar»**
  (Payment — и к нам, и от нас, противоречия нет). Раздел **не** называем «Cashflow»
  (во избежание путаницы с Rolling cashflow в Pulse) — ярлык секции **«Payments»**.
- **v1 IN-сторона = только ожидаемые (неоплаченные) инвойсы.** После оплаты инвойс
  пропадает из календаря (как и из Outstanding). Реализованные поступления по дате
  receipt — возможный follow-up, не входит в этот объём.

## Источники данных

Ничего не мигрируем, читаем существующие таблицы.

### OUT (кредиторка) — без изменений к текущей логике
- `public.purchase_orders` (`sbPublic`): `id, po_number, order_date, supplier, total_thb,
  status, url, cashflow_override, paid_at, docs_url`.
- `inventory.supplier` (`sbInventory`): `name, type, payment_terms_days`.
- Дата платежа = `paid_at` (если оплачен), иначе `order_date + supplier.payment_terms_days`
  (`computeDueDate` из `lib/kpi.ts`).
- Фильтр `eligible()`: только `status='closed'`, не `consignment`, не
  `cashflow_override='exclude'`, есть `order_date`.

### IN (дебиторка) — новое, та же формула, что на Outstanding
- `inventory.flowaccount_invoice` (`sbInventory`): `id, number, customer_id,
  customer_name, issued_at, due_at, status, total, detail_url, excluded`.
- Фильтр: `status NOT IN ('Paid','Cancelled')` и `excluded = false`.
- `inventory.b2b_customer`: `id, payment_terms_days` → отсрочка по клиенту.
- Дата поступления = `due_at || (terms > 0 ? issued_at + terms : null)`.
  `due_at` из FA часто `''` — оператор `||` ловит и пустую строку, и null.
- Сумма = `total` (уже с НДС = ожидаемый кэш).
- **Консигнация (Golden Brewery)** ложится по своему `payment_terms_days` (~7 дней) —
  специального кода нет, наследуется автоматически. Убедиться, что у Golden Brewery
  в `b2b_customer` выставлен недельный `payment_terms_days`.
- Инвойсы без вычислимой даты (`computedDue === null`) **не размещаются** на таймлайне
  и не входят в NET — выводятся отдельным коротким списком под таблицей с подсказкой
  «set terms» (ссылка на `/m/inventory/customers`), чтобы не терялись.

## Модель строки

Единый тип события календаря:

```ts
type CalEvent = {
  date: string            // ISO дата платежа/поступления
  dir: 'out' | 'in'
  who: string             // supplier name | customer_name
  label: string           // po_number | invoice number
  amount: number          // total_thb | invoice.total (всегда положительное)
  href: string | null     // PO url | invoice detail_url
  status: 'overdue' | 'today' | 'future' | 'paid'
  net?: number            // бегущий нетто, проставляется после сортировки
}
```

Сборка: смешиваем OUT и IN в один массив, сортируем по `date`, затем одним проходом
считаем `net += (dir === 'in' ? amount : -amount)` и пишем `net` в каждую строку.

`status` относительно `todayBkk()`: `date < today && !paid → overdue`;
`date === today → today`; иначе `future`. Для OUT `paid_at != null → paid`.
В v1 IN-строки бывают только `overdue|today|future` (оплаченные отфильтрованы).

## Виды (сохраняем текущую двухрежимную структуру)

Параметр `searchParams.month` (YYYY-MM); отсутствует → «Open». Полоса месяцев и
переключатель Open остаются как есть.

### Open
Все открытые OUT+IN, одна таблица, сортировка по дате.
Колонки: `Date · Doc · Counterparty · OUT · IN · NET`.
KPI-карточки: **Total OUT**, **Total IN**, **NET** (IN − OUT). Просрочка по каждой
стороне — подписью в соответствующей карточке.

### Месяц (YYYY-MM)
Та же таблица, отфильтрованная по месяцу (`date` в месяце), бегущий NET внутри месяца.
- OUT: неоплаченные с `computedDue` в месяце + оплаченные PO с `paid_at` в месяце
  (зелёные) — как сейчас.
- IN: ожидаемые инвойсы с `computedDue` в месяце.
KPI: **К оплате (OUT)**, **К получению (IN)**, **Оплачено (PO)**, **NET**.

## Тонирование строк

- `overdue` → `bg-wine-red/[0.05]`
- `today` → `bg-amber-gold/[0.10]`
- `paid` → `bg-emerald-600/[0.07]`
- IN-строки визуально отличаются от OUT: сумма стоит в колонке IN (для OUT — в OUT),
  плюс направленческий маркер (↘ in / ↗ out) в колонке Doc. Базовый стиль и статус-тинты
  переиспользуем — это уже знакомый паттерн страницы.

## Навигация (`lib/registry.ts`)

- Добавить секцию `{ key: 'payments', label: 'Payments', description: '...', items: [...] }`
  **сразу после Pulse**, перед Operations.
- `SectionKey` расширить значением `'payments'`.
- Пункт `payment-calendar` **переместить** из Operations в новую секцию.
  Имя «Payment Calendar», slug/route `/m/payment-calendar` без изменений. Описание
  обновить: «Платежи в обе стороны — кредиторка (PO) и дебиторка (B2B-инвойсы) по датам».

## Файлы

- `app/(portal)/m/payment-calendar/page.tsx` — основной рефактор: добавить выборку
  инвойсов + клиентских отсрочек, собрать `CalEvent[]`, переписать Open/Month виды
  на единый нетто-таймлайн с колонками OUT/IN/NET.
- `lib/registry.ts` — новая секция `payments`, перенос пункта, тип `SectionKey`.
- Возможен новый маленький helper для `addDays`/`computedDue` инвойса (или
  переиспользовать существующие из `lib/kpi.ts` / локальные хелперы).

## Вне scope

- Миграции БД, новые колонки.
- Ручная отметка «получено» по дебиторке.
- Реализованные поступления по дате receipt (join в `flowaccount_receipt`) — follow-up.
- Изменения логики PO и страницы Outstanding.

## Проверка

- `npm run build` в `02_services/mission-control` проходит.
- Open: суммы OUT совпадают с прежним календарём; IN-итог совпадает с «Open» на
  странице Outstanding (с поправкой на инвойсы без даты, вынесенные отдельно).
- Месяц: оплаченные PO зелёные на своих датах; ожидаемые инвойсы стоят на `computedDue`;
  NET = IN − OUT по месяцу.
- Golden Brewery появляется по недельной отсрочке, не по +30.
- Сайдбар: «Payments» первым после Pulse, в Operations пункта больше нет.
