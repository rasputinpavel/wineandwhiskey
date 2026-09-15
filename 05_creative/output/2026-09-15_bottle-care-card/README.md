# Памятка клиенту по закупке — 2026-09-15

Одностраничная A4-карточка (RU) для клиента: как хранить и подавать 5 купленных бутылок,
какие нужны бокалы, сколько живёт открытая бутылка.

Позиции: Palazzo Grimani Black Label Extra Dry · Delot Champagne Blanc de Noirs Brut ·
Selbach Riesling «Incline» Dry · Alamos Malbec · Camus VSOP Borderies.

## Варианты

- `bottle-care-card-light_2026-09-15.*` — **основной**: вертикальный лист 480px, светлая тема,
  формат payslip (один длинный PDF без пагинации, `@page size` = высота контента). Для мессенджера.
- `bottle-care-card_2026-09-15.*` — тёмный A4 (первая версия, на печать).

Высота листа для `@page` снимается из страницы: в HTML есть скрипт, который пишет
`SHEETHEIGHT:<px>` в `<title>`; забрать через
`chrome --headless --virtual-time-budget=3000 --dump-dom <html> | grep -o 'SHEETHEIGHT:[0-9]*'`.

Рендер: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --no-pdf-header-footer --print-to-pdf=bottle-care-card_2026-09-15.pdf bottle-care-card_2026-09-15.html`
превью: `pdftoppm -png -r 110 -singlefile <pdf> <name>_preview`
