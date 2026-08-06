# Harvest — смена HC-цен с августовского цикла (2026-08)

**Дата фиксации:** 2026-08-04 (при закрытии июльского цикла)
**Источник новых цен:** Loyverse stock adjustment **SA1205** (приход 31 июля 2026), колонка Cost.

## Правило применения
- **Июльский цикл (5 июл – 4 авг 2026)** — все старые позиции биллятся по **СТАРЫМ** HC. Счёт July = **25,560 ฿** (subtotal 23,888 + VAT 1,672). Причина: основные продажи цикла сделаны в июле по старым ценам; новый приход зашёл только 31.07.
- **С августовского цикла (с 5 авг 2026)** — переписать HC этих 16 позиций на новые (Cost из SA1205).
- `consignment_price` НЕ имеет измерения по периодам → менять цены **только после** того, как июльский settlement-PO заведён в Loyverse (иначе июльский отчёт пересчитается по новым ценам). Порядок: закрыть июль → PO 25,560 → затем апдейт цен.

## Таблица изменения (16 позиций)

| SKU code | Позиция | Старый HC (июль) | Новый HC (с авг) |
|---|---|---:|---:|
| 10255 | Barrister Dry Gin 0.7L | 755 | 634 |
| ADV.D.RoBr | Victor Dravigny «Whilte» Brut Abrau Durso | 600 | 667 |
| ADV.D.WhBr | Victor Dravigny Rose Brut Abrau Durso | 600 | 667 |
| 10252 | Czar's Vodka Original 0.7L | 510 | 496 |
| 10251 | Czar's Vodka Original 1L | 675 | 659 |
| 10481 | Vedernikov «Krasnostop Zolotovsky» 2020 | 999 | 1016 |
| 10501 | ABRAU DURSO Rose Brut RESERVE | 425 | 415 |
| 10511 | Abrau Riesling | 750 | 740 |
| 10573 | Barrister Sloe Gin 0,7L | 825 | 805 |
| ChTamTerroir | Chateau Tamagne TERROIR Krasnostop Saperavi | 450 | 480 |
| ChTamNude | Chateau Tamagne NUDE SAPERAVI Red Dry | 460 | 480 |
| ChTamGrapeDance | Chateau Tamagne GRAPE DANCE Blanc | 415 | 447 |
| ChTamSCRSaperavi | South Coast Reserve Saperavi 2020 | 555 | 557 |
| ChTamSCRCabSauv | South Coast Reserve Cabernet Sauvignon | 555 | 557 |
| ChTamSCRKrasn2020 | South Coast Reserve Krasnostop 2020 | 555 | 557 |
| ChTamSCRPrRouge | South Coast Reserve Premier Rouge | 555 | 557 |

## Прочее
- 17 новых позиций из SA1205 (Sparkling 200/750, DUO, Signature, Anima, Chardonnay 2025, Cabernet 2024, NATUR ORANGE, Victor Dravigny White Extra Brut) уже прайсованы из скринов и активны с июля.
- В июле по новым/непрайсованным раньше позициям продано: Sparkling BRUT White 200ML ×2, Sparkling BRUT Rose 200ML ×1 — учтены в счёте.
