# 07_contacts — партнёры и команда

Источник правды по людям и компаниям, с которыми у нас есть отношения. Карточки в markdown, договоры рядом, переписки — отдельным архивом.

## Структура

```
partners/<slug>/        # внешние: поставщики, бренды, B2B, медиа, подрядчики
  profile.md            # кто, контакты, статус, история (см. templates/partner-profile.md)
  contracts/            # PDF/MD договоров и приложений
  programs.md           # бонусы, скидки, мотивация (если есть)
  notes/                # YYYY-MM-DD_<topic>.md — встречи, созвоны, договорённости
  chats/                # экспорты переписок (WhatsApp/Telegram), позже

team/<slug>/            # сотрудники
  profile.md            # см. templates/team-profile.md
  compensation.md       # зп, KPI, бонусы (см. templates/compensation.md)
  notes/

templates/              # шаблоны для копирования в новую карточку
```

## Naming

`<slug>` — kebab-case латиницей: `ivan-petrov`, `winery-catena`, `karaoke-bar-phuket`.
Не используем кириллицу и пробелы в именах папок.

## Связка с ЦУП

`07_contacts/` — источник правды. Портал [02_services/mission-control/](../02_services/mission-control/) будет читать карточки и показывать их в UI. Подключение — отдельной задачей, пока всё ведём в md.

## Чувствительные данные

`compensation.md`, договоры и личные данные — чувствительные. Репо приватный, но решение про `.gitignore` для подпапок team/ ещё не принято. До этого — не пушим в публичные форки/PR.
