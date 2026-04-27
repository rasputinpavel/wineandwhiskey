import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
async function main() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token" })
  });
  const { access_token } = await r.json() as any;
  // DATE(2026,4,20) serial = check all rows, filter >=46131 (Apr 20 2026)
  const r2 = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY/values/" +
    encodeURIComponent("Расходы!A1:C100") + "?valueRenderOption=UNFORMATTED_VALUE",
    { headers: { Authorization: "Bearer " + access_token } }
  );
  const rows: any[][] = (await r2.json() as any).values || [];
  // Apr 20 2026 serial
  const apr20 = 46131, apr26 = 46137;
  console.log("All rows with date serial >= Apr 20 2026:");
  rows.forEach((row, i) => {
    const d = Number(row[0]);
    if (d >= apr20 && d <= apr26 + 100) console.log(`  Row ${i+1}: serial=${d}, amount=${row[1]}, desc=${row[2]}`);
  });
  console.log("\nAll unique date serials in sheet:");
  const serials = [...new Set(rows.slice(1).map(r => r[0]).filter(Boolean))];
  serials.forEach(s => console.log(`  serial ${s} → approx ${new Date((Number(s)-25569)*86400000).toISOString().slice(0,10)}`));
}
main().catch(console.error);
