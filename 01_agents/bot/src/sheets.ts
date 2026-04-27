const SHEET_ID = "1rWDWoo9L23WwVG6bbl-Z6tC-klIoN6FNie_kNECRmrY";

let _token: string | null = null;

async function gToken(): Promise<string | null> {
  const id  = process.env.GOOGLE_CLIENT_ID;
  const sec = process.env.GOOGLE_CLIENT_SECRET;
  const ref = process.env.GOOGLE_REFRESH_TOKEN;
  if (!id || !sec || !ref) return null;

  if (_token) return _token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: sec, refresh_token: ref, grant_type: "refresh_token" }),
  });
  if (!r.ok) return null;
  _token = (await r.json()).access_token;
  // Reset cache after 50 minutes
  setTimeout(() => { _token = null; }, 50 * 60 * 1000);
  return _token;
}

async function readSheet(token: string, tab: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${tab}!${range}`)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const d = await r.json();
  return d.values ?? [];
}

function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

function daysUntil(dateStr: string): number | null {
  // Accept DD.MM.YYYY or YYYY-MM-DD
  let iso = dateStr.trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(iso)) {
    const [d, m, y] = iso.split(".");
    iso = `${y}-${m}-${d}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const today = bangkokToday();
  const diff = (new Date(iso + "T12:00:00Z").getTime() - new Date(today + "T12:00:00Z").getTime()) / 86_400_000;
  return Math.round(diff);
}

function dueDateLabel(days: number): string {
  if (days < 0)  return `просрочено на ${Math.abs(days)} дн.`;
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} дн.`;
}

export interface PaymentAlert {
  tab:      "Дебиторка" | "Кредиторка";
  name:     string;
  amount:   string;
  dueDate:  string;
  daysLeft: number;
}

export async function getPaymentAlerts(withinDays = 3): Promise<PaymentAlert[]> {
  const token = await gToken();
  if (!token) return [];

  const alerts: PaymentAlert[] = [];

  // Дебиторка: column A = name, column C = amount, column D = due date
  // Read up to column G to catch the status column wherever it may be
  const deb = await readSheet(token, "Дебиторка", "A2:G200");
  for (const row of deb) {
    const isPaid = row.some(cell => cell?.trim().toLowerCase() === "paid");
    if (isPaid) continue;
    const name    = row[0]?.trim() ?? "";
    const amount  = row[2]?.trim() ?? "";
    const dateStr = row[3]?.trim() ?? "";
    if (!name || !dateStr) continue;
    const days = daysUntil(dateStr);
    if (days === null) continue;
    if (days <= withinDays) {
      alerts.push({ tab: "Дебиторка", name, amount, dueDate: dateStr, daysLeft: days });
    }
  }

  // Кредиторка: column A = name, column D = amount, column E = due date
  // Read up to column G to catch the status column wherever it may be
  const kred = await readSheet(token, "Кредиторка", "A2:G200");
  for (const row of kred) {
    const isPaid = row.some(cell => cell?.trim().toLowerCase() === "paid");
    if (isPaid) continue;
    const name    = row[0]?.trim() ?? "";
    const amount  = row[3]?.trim() ?? "";
    const dateStr = row[4]?.trim() ?? "";
    if (!name || !dateStr) continue;
    const days = daysUntil(dateStr);
    if (days === null) continue;
    if (days <= withinDays) {
      alerts.push({ tab: "Кредиторка", name, amount, dueDate: dateStr, daysLeft: days });
    }
  }

  return alerts.sort((a, b) => a.daysLeft - b.daysLeft);
}

export function formatPaymentAlerts(alerts: PaymentAlert[]): string {
  if (alerts.length === 0) return "";

  const deb  = alerts.filter(a => a.tab === "Дебиторка");
  const kred = alerts.filter(a => a.tab === "Кредиторка");
  const lines: string[] = [];

  if (deb.length > 0) {
    lines.push("💰 <b>Нам должны (Дебиторка):</b>");
    for (const a of deb) {
      const label = dueDateLabel(a.daysLeft);
      const amt   = a.amount ? ` — ${a.amount}` : "";
      lines.push(`• <b>${a.name}</b>${amt} — <i>${label}</i>`);
    }
  }

  if (kred.length > 0) {
    lines.push("📤 <b>Мы должны (Кредиторка):</b>");
    for (const a of kred) {
      const label = dueDateLabel(a.daysLeft);
      const amt   = a.amount ? ` — ${a.amount}` : "";
      lines.push(`• <b>${a.name}</b>${amt} — <i>${label}</i>`);
    }
  }

  return lines.join("\n");
}
