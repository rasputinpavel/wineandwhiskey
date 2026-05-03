/**
 * Закупочная матрица — Apps Script для Google Sheets.
 *
 * УСТАНОВКА:
 * 1. Открой таблицу
 *    https://docs.google.com/spreadsheets/d/10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg/edit
 * 2. Меню → Extensions → Apps Script
 * 3. Удали дефолтный код, вставь содержимое этого файла, сохрани
 * 4. Меню Apps Script → Project Settings → Script Properties → добавь:
 *      WEBHOOK_URL    = https://<твой-railway-host>/run
 *      WEBHOOK_SECRET = <тот же секрет, что в env Railway сервиса matrix-runner>
 * 5. Перезагрузи таблицу. В строке меню появится «Закупка» с пунктом «Пересчитать матрицу».
 *
 * Вызов: меню «Закупка» → «Пересчитать матрицу».
 * Скрипт дёрнет webhook, дождётся завершения (до 6 мин — лимит UrlFetchApp),
 * покажет тост со сводкой и переключит на лист «Закупочная матрица».
 */

const ACTIVE_TAB = "Закупочная матрица";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Закупка")
    .addItem("Пересчитать матрицу", "runMatrix")
    .addItem("Открыть лист параметров", "openParams")
    .addToUi();
}

function openParams() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("Параметры-матрица");
  if (sheet) ss.setActiveSheet(sheet);
  else SpreadsheetApp.getUi().alert("Лист «Параметры-матрица» не найден. Запусти матрицу хотя бы раз.");
}

function runMatrix() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("WEBHOOK_URL");
  const secret = props.getProperty("WEBHOOK_SECRET");
  if (!url || !secret) {
    SpreadsheetApp.getUi().alert(
      "Не настроены WEBHOOK_URL и WEBHOOK_SECRET в Script Properties.\n\n" +
      "Apps Script → Project Settings → Script Properties → добавь оба ключа."
    );
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  ss.toast("Запускаю пересчёт матрицы…", "Закупка", -1);

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "x-webhook-secret": secret },
      payload: JSON.stringify({}),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    let body;
    try { body = JSON.parse(resp.getContentText()); } catch (e) { body = { raw: resp.getContentText() }; }

    if (code !== 200 || !body.ok) {
      ss.toast("Ошибка пересчёта", "Закупка", 8);
      ui.alert(
        "Ошибка пересчёта матрицы",
        "HTTP " + code + "\n\n" +
        (body.stderr || body.raw || JSON.stringify(body)).slice(0, 1500),
        ui.ButtonSet.OK
      );
      return;
    }

    const summary = (body.summary || []).join("\n");
    ss.toast("Готово · " + body.elapsed_sec + " с", "Закупка", 5);

    // Switch to the matrix tab automatically.
    const matrixTab = ss.getSheetByName(ACTIVE_TAB);
    if (matrixTab) ss.setActiveSheet(matrixTab);

    ui.alert(
      "Матрица пересчитана",
      "Время: " + body.elapsed_sec + " с\n\n" + (summary || "Лог свёрнут."),
      ui.ButtonSet.OK
    );
  } catch (err) {
    ss.toast("Сбой запроса", "Закупка", 5);
    ui.alert("Сбой запроса", String(err), ui.ButtonSet.OK);
  }
}
