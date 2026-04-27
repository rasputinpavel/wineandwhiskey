/**
 * Wine & Whiskey — Aviasales Order Sheet
 *
 * Создаёт красиво оформленный лист заказа с полем «Кол-во»
 * и автоматическим подсчётом итога.
 *
 * Как запустить:
 *   Google Sheets → Расширения → Apps Script → вставить код → Run → setupAviasalesOrder
 */

// ─── ДАННЫЕ ────────────────────────────────────────────────────────────────

var AVAILABLE = [
  [1,  'Calrossie Vineyard Pinot Noir',              'Новая Зеландия, Мальборо',      747],
  [2,  'Cantina Terlano Gewürztraminer',              'Италия, Альто-Адидже',         1278],
  [3,  'Corte Giara Valpolicella DOC',                'Италия, Венето',                882],
  [4,  'Alain de la Treille Sauvignon Blanc',         'Франция, Долина Луары',         738],
  [5,  'Patriarche Endless Summer Pinot Noir',        'Франция, Лангедок-Руссильон',   719],
  [6,  'Corte Rinieri Chianti Classico Riserva',      'Италия, Тоскана',              1071],
  [7,  'Matua Sauvignon Blanc',                       'Новая Зеландия, Мальборо',      629],
  [8,  'Elettra Primitivo-Negroamaro Puglia',         'Италия, Апулия',               1143],
  [9,  'Seresin Sauvignon Blanc',                     'Новая Зеландия, Мальборо',     1251],
];

var SUBS = [
  {
    num: '10',
    original: 'Kumeu River Pinot Gris · Новая Зеландия, Мальборо',
    alts: [
      ['10а', 'Tohu Awatere Valley Pinot Gris',          'Новая Зеландия, Мальборо',   891],
      ['10б', 'Pinot Bianco · Cantina Terlano',           'Италия, Альто-Адидже',      1152],
    ]
  },
  {
    num: '11',
    original: 'Garage Wine Co. País 2020 · Чили',
    alts: [
      ['11а', 'Tierra Sagrada Almaule País',              'Чили',                       738],
    ]
  },
  {
    num: '12',
    original: 'Diggins Estate Chardonnay',
    alts: [
      ['12а', 'Stonehaven Stepping Stone Chardonnay',    'Австралия',                   612],
      ['12б', 'Schild Estate Barossa Chardonnay',        'Австралия, Баросса',          783],
      ['12в', 'Miles From Nowhere Chardonnay',           'Австралия, Margaret River',   738],
    ]
  },
  {
    num: '13',
    original: 'Ego Bodegas Goru Organic Monastrell · Испания, Хумилья',
    alts: [
      ['13а', 'Cepas Viejas Monastrell D.O.P. Alicante', 'Испания, Аликанте',          1017],
      ['13б', 'Telmo Rodríguez Al-Muvedre Monastrell',   'Испания, Аликанте',           711],
    ]
  },
];

// ─── ЦВЕТА (W&W design tokens) ─────────────────────────────────────────────

var C = {
  black:    '#1A1A1A',
  cream:    '#F5F0EB',
  cream2:   '#EDE0D0',
  stone:    '#D4C9BC',
  red:      '#8C1C1C',
  gold:     '#C9A84C',
  graphite: '#3D3D3D',
  white:    '#FFFFFF',
  rowA:     '#F5F0EB',
  rowB:     '#FAF6F2',
  subHdr:   '#242424',
};

var BS = SpreadsheetApp.BorderStyle;

// ─── ГЛАВНАЯ ФУНКЦИЯ ────────────────────────────────────────────────────────

function setupAviasalesOrder() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Удалить старый лист «Заказ» если есть, создать новый
  var existing = ss.getSheetByName('Заказ');
  if (existing) ss.deleteSheet(existing);
  var sheet = ss.insertSheet('Заказ');

  // Убрать лишние колонки (оставить 6)
  if (sheet.getMaxColumns() > 6) {
    sheet.deleteColumns(7, sheet.getMaxColumns() - 6);
  }

  // Ширины колонок
  sheet.setColumnWidth(1, 46);   // #
  sheet.setColumnWidth(2, 265);  // Вино
  sheet.setColumnWidth(3, 165);  // Регион
  sheet.setColumnWidth(4, 90);   // Цена
  sheet.setColumnWidth(5, 80);   // Кол-во
  sheet.setColumnWidth(6, 105);  // Сумма

  var r = 1; // указатель текущей строки

  // ── 1. ШАПКА ─────────────────────────────────────────────────────────────
  r = writeHeader(sheet, r);

  // ── 2. ДОСТУПНЫЕ ВИНА ────────────────────────────────────────────────────
  r = writeSectionLabel(sheet, r, '  В НАЛИЧИИ  —  9 ПОЗИЦИЙ');
  r = writeAvailableWines(sheet, r);

  divider(sheet, r, C.stone, 3); r++;

  // ── 3. ЗАМЕНЫ ─────────────────────────────────────────────────────────────
  r = writeSectionLabel(sheet, r, '  ЗАМЕНЫ И РЕКОМЕНДАЦИИ  —  ПОЗИЦИИ 10–13');
  r = writeNote(sheet, r,
    '  Эти позиции временно отсутствуют. Выберите замену и укажите количество.');
  r = writeSubstitutions(sheet, r);

  divider(sheet, r, C.stone, 3); r++;

  // ── 4. ИТОГО ──────────────────────────────────────────────────────────────
  r = writeTotalRow(sheet, r);

  // Заморозить шапку (4 строки)
  sheet.setFrozenRows(4);

  // Переименовать таблицу
  try { ss.rename('W&W × Aviasales — Заказ вин'); } catch(e) {}

  SpreadsheetApp.getUi().alert(
    '✅  Готово!\n\n' +
    'Введите количество в белые ячейки столбца «Кол-во» —\n' +
    'сумма пересчитается автоматически.\n\n' +
    'Цены в THB, включая VAT и скидку.'
  );
}

// ─── БЛОКИ ─────────────────────────────────────────────────────────────────

function writeHeader(sheet, r) {
  // Строка 1: Название
  sheet.setRowHeight(r, 42);
  var t = sheet.getRange(r, 1, 1, 6);
  t.merge()
   .setValue('WINE & WHISKEY  ·  PHUKET')
   .setBackground(C.black)
   .setFontColor(C.cream)
   .setFontFamily('Arial')
   .setFontWeight('bold')
   .setFontSize(15)
   .setHorizontalAlignment('left')
   .setVerticalAlignment('middle');
  // Красная левая граница как акцент
  sheet.getRange(r, 1, 1, 1)
    .setBorder(null, true, null, null, null, null, C.red, BS.SOLID_THICK);
  r++;

  // Строка 2: Подзаголовок
  sheet.setRowHeight(r, 22);
  sheet.getRange(r, 1, 1, 6).merge()
    .setValue('  Подбор вин для Aviasales  ·  апрель 2026  ·  Цены в THB, включая VAT и скидку')
    .setBackground(C.black)
    .setFontColor('#585350')
    .setFontFamily('Arial')
    .setFontSize(8)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  r++;

  // Строка 3: Красная полоса
  divider(sheet, r, C.red, 4); r++;

  // Строка 4: Заголовки колонок
  sheet.setRowHeight(r, 28);
  sheet.getRange(r, 1, 1, 6)
    .setValues([['#', 'ВИНО', 'РЕГИОН / СТРАНА', 'ЦЕНА', 'КОЛ-ВО', 'СУММА']])
    .setBackground(C.cream2)
    .setFontColor(C.graphite)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(8)
    .setVerticalAlignment('middle');
  sheet.getRange(r, 1).setHorizontalAlignment('center');
  sheet.getRange(r, 2).setHorizontalAlignment('left');
  sheet.getRange(r, 3).setHorizontalAlignment('left');
  sheet.getRange(r, 4).setHorizontalAlignment('right');
  sheet.getRange(r, 5).setHorizontalAlignment('center');
  sheet.getRange(r, 6).setHorizontalAlignment('right');
  sheet.getRange(r, 1, 1, 6)
    .setBorder(null, null, true, null, null, null, C.graphite, BS.SOLID);
  r++;

  return r;
}

function writeSectionLabel(sheet, r, text) {
  sheet.setRowHeight(r, 24);
  sheet.getRange(r, 1, 1, 6).merge()
    .setValue(text)
    .setBackground(C.black)
    .setFontColor(C.gold)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(8)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  return r + 1;
}

function writeNote(sheet, r, text) {
  sheet.setRowHeight(r, 24);
  sheet.getRange(r, 1, 1, 6).merge()
    .setValue(text)
    .setBackground(C.cream2)
    .setFontColor(C.graphite)
    .setFontFamily('Arial')
    .setFontSize(7)
    .setFontStyle('italic')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');
  return r + 1;
}

function writeAvailableWines(sheet, r) {
  for (var i = 0; i < AVAILABLE.length; i++) {
    var w   = AVAILABLE[i];
    var bg  = (i % 2 === 0) ? C.rowA : C.rowB;
    r = writeWineRow(sheet, r, w[0], w[1], w[2], w[3], bg, true);
  }
  return r;
}

function writeSubstitutions(sheet, r) {
  var altIdx = 0;
  for (var g = 0; g < SUBS.length; g++) {
    var grp = SUBS[g];

    // Заголовок группы: запрошенное вино (нет в наличии)
    sheet.setRowHeight(r, 28);
    sheet.getRange(r, 1)
      .setValue(grp.num)
      .setBackground(C.subHdr)
      .setFontColor(C.red)
      .setFontFamily('Arial')
      .setFontWeight('bold')
      .setFontSize(9)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.getRange(r, 2, 1, 4).merge()
      .setValue('✕  ' + grp.original)
      .setBackground(C.subHdr)
      .setFontColor('#585350')
      .setFontFamily('Arial')
      .setFontSize(8)
      .setFontStyle('italic')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
    sheet.getRange(r, 6)
      .setValue('НЕТ')
      .setBackground(C.red)
      .setFontColor(C.cream)
      .setFontFamily('Arial')
      .setFontWeight('bold')
      .setFontSize(7)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    r++;

    // Альтернативы
    for (var a = 0; a < grp.alts.length; a++) {
      var alt = grp.alts[a];
      var bg  = (altIdx % 2 === 0) ? C.rowA : C.rowB;
      altIdx++;
      r = writeWineRow(sheet, r, alt[0], alt[1], alt[2], alt[3], bg, false);
    }

    // Разделитель между группами
    if (g < SUBS.length - 1) {
      divider(sheet, r, C.cream2, 3); r++;
    }
  }
  return r;
}

// Универсальная строка вина
function writeWineRow(sheet, r, num, name, region, price, bg, isMain) {
  sheet.setRowHeight(r, 40);

  // #
  sheet.getRange(r, 1)
    .setValue(num)
    .setBackground(bg)
    .setFontColor(isMain ? C.stone : '#B0A898')
    .setFontFamily('Arial')
    .setFontSize(isMain ? 9 : 8)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  // Название
  sheet.getRange(r, 2)
    .setValue(name)
    .setBackground(bg)
    .setFontColor(C.black)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  // Регион
  sheet.getRange(r, 3)
    .setValue(region)
    .setBackground(bg)
    .setFontColor(C.graphite)
    .setFontFamily('Arial')
    .setFontSize(8)
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle');

  // Цена
  sheet.getRange(r, 4)
    .setValue(price)
    .setBackground(bg)
    .setFontColor(C.red)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setNumberFormat('#,##0');

  // Кол-во (поле ввода — белое)
  sheet.getRange(r, 5)
    .setValue(0)
    .setBackground(C.white)
    .setFontColor(C.black)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, null, null, C.stone, BS.SOLID);

  // Сумма (формула)
  sheet.getRange(r, 6)
    .setFormula('=IF(E' + r + '>0, D' + r + '*E' + r + ', "")')
    .setBackground(bg)
    .setFontColor(C.red)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setNumberFormat('#,##0');

  // Пунктирная нижняя граница
  sheet.getRange(r, 1, 1, 6)
    .setBorder(null, null, true, null, null, null, C.stone, BS.DOTTED);

  return r + 1;
}

function writeTotalRow(sheet, r) {
  sheet.setRowHeight(r, 48);

  sheet.getRange(r, 1, 1, 4).merge()
    .setValue('ИТОГО К ЗАКАЗУ')
    .setBackground(C.black)
    .setFontColor(C.cream)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(12)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle');

  sheet.getRange(r, 5)
    .setBackground(C.black);

  // SUMPRODUCT по всем строкам таблицы — умножает D*E везде, где E > 0
  sheet.getRange(r, 6)
    .setFormula('=SUMPRODUCT((E5:E' + (r - 2) + ')*(D5:D' + (r - 2) + '))')
    .setBackground(C.black)
    .setFontColor(C.gold)
    .setFontFamily('Arial')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('right')
    .setVerticalAlignment('middle')
    .setNumberFormat('#,##0 "฿"');

  // Рамка вокруг итоговой строки
  sheet.getRange(r, 1, 1, 6)
    .setBorder(true, true, true, true, null, null, C.red, BS.SOLID_MEDIUM);

  return r + 1;
}

// ─── ВСПОМОГАТЕЛЬНЫЕ ───────────────────────────────────────────────────────

function divider(sheet, r, color, height) {
  sheet.setRowHeight(r, height);
  sheet.getRange(r, 1, 1, 6).merge().setBackground(color);
}
