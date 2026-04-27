import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";
async function main() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token" })
  });
  const { access_token } = await r.json() as any;
  const r2 = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent("Cashflow!B19:B20")}?valueRenderOption=FORMULA`,
    { headers: { Authorization: "Bearer " + access_token } }
  );
  const d = await r2.json() as any;
  (d.values || []).forEach((row: string[], i: number) => console.log(`B${i+19}:`, row[0]));
}
main().catch(console.error);
