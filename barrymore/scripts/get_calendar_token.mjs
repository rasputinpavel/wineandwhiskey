// Одноразовый скрипт для получения Google Calendar refresh token.
// Запустить из корня проекта: node barrymore/scripts/get_calendar_token.mjs
import { createServer } from "http";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = "http://localhost:3333";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ],
});

console.log("\n=== Google Calendar Authorization ===\n");
console.log("Откройте ссылку в браузере (войдите как PavelRasputin@gmail.com):\n");
console.log(authUrl);
console.log("\nОжидаю авторизацию на http://localhost:3333 ...\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:3333");
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("Нет кода в запросе.");
    return;
  }

  res.end("<h2>Готово! Вернитесь в терминал.</h2>");
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\n=== Добавьте в .env.local и Railway: ===\n");
    console.log(`GOOGLE_CALENDAR_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\n(Это отдельный токен от GOOGLE_REFRESH_TOKEN — не заменяйте тот)\n");
  } catch (e) {
    console.error("Ошибка получения токена:", e.message);
  }
}).listen(3333);
