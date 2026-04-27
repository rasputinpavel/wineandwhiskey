import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: "refresh_token" })
  });
  const { access_token } = await r.json() as any;

  const r2 = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY/values/" +
    encodeURIComponent("Расходы!A1:C10") + "?valueRenderOption=UNFORMATTED_VALUE",
    { headers: { Authorization: "Bearer " + access_token } }
  );
  console.log("UNFORMATTED (raw serials/strings):");
  ((await r2.json() as any).values || []).forEach((row: any[], i: number) => console.log(`  Row ${i+1}:`, JSON.stringify(row)));

  const r3 = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY/values/" +
    encodeURIComponent("Расходы!A1:C10") + "?valueRenderOption=FORMATTED_VALUE",
    { headers: { Authorization: "Bearer " + access_token } }
  );
  console.log("\nFORMATTED (display):");
  ((await r3.json() as any).values || []).forEach((row: any[], i: number) => console.log(`  Row ${i+1}:`, JSON.stringify(row)));
}
main().catch(console.error);
// already defined above — need separate file
