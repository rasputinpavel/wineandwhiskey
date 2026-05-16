// Maps receipt_number → customer_name based on user's manual tagging
// in the "B2B без customer" sheet. Used to attribute anonymous bank-transfer
// receipts to the actual B2B client.

const SHEET_ID = "10EfJl0cfWj1GLoFXq9nHfZ4ZrlLcQloXs4ANRbt8HBg";
const TAB      = "B2B без customer";

// Canonicalize different spellings of the same client to one standard name.
// Order matters: longer matches first.
const CANONICAL: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /karon\s*paragon/i,                   name: "Karon Paragon Co.Ltd" },
  { pattern: /fine\s*cusine/i,                     name: "Fine Cusine Co.,LTD" },
  { pattern: /milimon/i,                           name: "Milimon Co., Ltd." },
  { pattern: /great\s*glory/i,                     name: "Great Glory Co., Ltd." },
  { pattern: /golden\s*brew/i,                     name: "Golden Brewery Co., Ltd." },
  { pattern: /bella\s*chao/i,                      name: "Bella Chao Trade Co., Ltd." },
  { pattern: /q[-\s]?squad/i,                      name: "Q-Squad Co.,Ltd" },
  { pattern: /jetradar/i,                          name: "Jetradar (Thailand) Co., Ltd." },
  { pattern: /seaview/i,                           name: "The Seaview Destination" },
  { pattern: /tbilisi/i,                           name: "Tbilisi Co.,Ltd" },
  { pattern: /lazy\s*avocado/i,                    name: "Lazy Avocado Co., Ltd." },
  { pattern: /layan\s*paradise/i,                  name: "Layan Paradise Villa Co., Ltd" },
  { pattern: /arthouse/i,                          name: "Arthouse Hotelmanagement Co., Ltd." },
  { pattern: /crepes/i,                            name: "Crepes Factory Co.,Ltd." },
  { pattern: /kusna[ck]afe/i,                      name: "Kusnacafe Co.,LTD" },
  { pattern: /pinzerai/i,                          name: "Pinzerai Co Ltd" },
  { pattern: /isak/i,                              name: "Isak" },
  { pattern: /titov/i,                             name: "Titov" },
];

export function canonicalize(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  for (const c of CANONICAL) if (c.pattern.test(trimmed)) return c.name;
  return trimmed;  // unknown → keep as-is
}

let _gToken: string | null = null;
async function gToken() {
  if (_gToken) return _gToken;
  // Read env lazily — dotenv.config() in caller may run after this module is imported (ESM eval order).
  const id     = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Google OAuth env vars missing — make sure dotenv.config(.env.local) ran before loadB2BOverrides()");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`OAuth2: ${await r.text()}`);
  _gToken = (await r.json()).access_token;
  return _gToken!;
}

let _cache: Map<string, string> | null = null;

/**
 * Loads the user's manual B2B-customer tagging from the
 * "B2B без customer" sheet.
 *
 * Returns Map<receipt_number, canonical_customer_name>.
 * Cached for the lifetime of the process.
 */
export async function loadB2BOverrides(): Promise<Map<string, string>> {
  if (_cache) return _cache;
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${TAB}!A1:H300`)}`,
    { headers: { Authorization: `Bearer ${await gToken()}` } },
  );
  if (!r.ok) {
    console.warn(`[b2b_overrides] failed to read tagging sheet: ${r.status}`);
    _cache = new Map();
    return _cache;
  }
  const rows = (await r.json()).values ?? [];
  // Find the header row that contains "Дата/время".
  let hdrIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? "").startsWith("Дата/время")) { hdrIdx = i; break; }
  }
  const map = new Map<string, string>();
  if (hdrIdx < 0) { _cache = map; return map; }
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.[0]) break;
    const recNum = String(row[1] ?? "").trim();
    const whoIs  = canonicalize(String(row[7] ?? ""));
    if (recNum && whoIs) map.set(recNum, whoIs);
  }
  _cache = map;
  return map;
}
