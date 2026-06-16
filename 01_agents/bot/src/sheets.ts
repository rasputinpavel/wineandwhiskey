function dueDateLabel(days: number): string {
  if (days < 0)  return `просрочено на ${Math.abs(days)} дн.`;
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} дн.`;
}

// Счета, которые висят в Кредиторке/Дебиторке, но платиться не будут —
// исключаем из утреннего брифинга (не помечаем "paid", т.к. это не оплата).
const SKIP_NAMES = ["titov", "титов"];

function isSkipped(name: string): boolean {
  const n = name.trim().toLowerCase();
  return SKIP_NAMES.some(s => n.includes(s));
}

export interface PaymentAlert {
  tab:      "Дебиторка" | "Кредиторка";
  name:     string;
  amount:   string;
  dueDate:  string;
  daysLeft: number;
}

// Источник дебиторки/кредиторки — Mission Control (Payment Calendar), а не Google
// Sheet: оплаченные PO (paid_at) и закрытые инвойсы (status) отпадают автоматически,
// так что бот больше не показывает уже оплаченные счета. Окно (withinDays) и skip
// (Titov) применяем здесь, на стороне бота.
interface AlertItem { name: string; date: string; amount: number; daysUntil: number }
interface AlertsResponse { today: string; receivables: AlertItem[]; payables: AlertItem[] }

const fmtAmount = (n: number): string =>
  n ? `฿${Math.round(n).toLocaleString("en-US")}` : "";

export async function getPaymentAlerts(withinDays = 3): Promise<PaymentAlert[]> {
  const base   = process.env.MISSION_CONTROL_URL;
  const secret = process.env.PAYABLES_ALERT_SECRET;
  if (!base || !secret) return [];

  let data: AlertsResponse;
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/api/public/payables-alerts`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!r.ok) return [];
    data = await r.json();
  } catch {
    return [];
  }

  const alerts: PaymentAlert[] = [];
  const collect = (items: AlertItem[], tab: PaymentAlert["tab"]) => {
    for (const it of items ?? []) {
      if (!it.name || !it.date) continue;
      if (isSkipped(it.name)) continue;
      if (it.daysUntil <= withinDays) {
        alerts.push({ tab, name: it.name, amount: fmtAmount(it.amount), dueDate: it.date, daysLeft: it.daysUntil });
      }
    }
  };
  collect(data.receivables, "Дебиторка");
  collect(data.payables,    "Кредиторка");

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
