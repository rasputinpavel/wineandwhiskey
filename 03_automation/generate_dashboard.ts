/**
 * generate_dashboard.ts
 * Fetches Loyverse sales data and generates a self-contained HTML dashboard.
 *
 * Usage:
 *   npx tsx scripts/generate_dashboard.ts            # current month
 *   npx tsx scripts/generate_dashboard.ts 2026-03    # specific month
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config({ path: ".env.local" });

const LOYVERSE_TOKEN = process.env.LOYVERSE_API_TOKEN!;

// ─── Bangkok time ─────────────────────────────────────────────────────────

function bangkokNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${ym}-01`, to: `${ym}-${pad(lastDay)}` };
}

function prevYear(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const names = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  const [y, m] = ym.split("-").map(Number);
  return `${names[m - 1]} ${y}`;
}

// ─── Loyverse ─────────────────────────────────────────────────────────────

async function loyverseFetch<T>(path: string, key: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  do {
    const url = `https://api.loyverse.com/v1.0${path}${path.includes("?") ? "&" : "?"}limit=250${cursor ? `&cursor=${cursor}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${LOYVERSE_TOKEN}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Loyverse ${res.status}: ${path}`);
      const data = await res.json();
      results.push(...(data[key] ?? []));
      cursor = data.cursor;
    } finally {
      clearTimeout(timeout);
    }
  } while (cursor);
  return results;
}

interface DayData {
  revenue: number;
  checks: number;
  gp: number;
}

async function fetchMonthByDay(ym: string): Promise<{ byDay: Map<number, DayData>; total: number; totalGP: number; checks: number }> {
  const { from, to } = monthBounds(ym);
  const isoFrom = new Date(from).toISOString();
  const isoTo = new Date(to + "T23:59:59").toISOString();

  const receipts: any[] = await loyverseFetch(
    `/receipts?receipt_type=SALE&created_at_min=${isoFrom}&created_at_max=${isoTo}`,
    "receipts"
  );

  const byDay = new Map<number, DayData>();
  let total = 0, totalGP = 0, checks = 0;

  for (const r of receipts) {
    const bkDate = new Date(new Date(r.receipt_date).getTime() + 7 * 60 * 60 * 1000);
    const day = bkDate.getUTCDate();

    const revenue = r.total_money ?? 0;
    let cost = 0;
    for (const li of r.line_items ?? []) cost += li.cost_total ?? 0;
    const gp = revenue - cost;

    const existing = byDay.get(day) ?? { revenue: 0, checks: 0, gp: 0 };
    byDay.set(day, { revenue: existing.revenue + revenue, checks: existing.checks + 1, gp: existing.gp + gp });

    total += revenue;
    totalGP += gp;
    checks++;
  }

  return { byDay, total, totalGP, checks };
}

// ─── Build cumulative arrays ──────────────────────────────────────────────

function cumulativeArray(byDay: Map<number, DayData>, daysInMonth: number, cutDay?: number): number[] {
  let running = 0;
  const result: (number | null)[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    if (cutDay !== undefined && d > cutDay) {
      result.push(null);
    } else {
      running += byDay.get(d)?.revenue ?? 0;
      result.push(Math.round(running));
    }
  }
  return result as number[];
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ─── Fetch last N months summary ──────────────────────────────────────────

async function fetchMonthlySummary(currentYM: string, n = 6) {
  const months: string[] = [];
  const [cy, cm] = currentYM.split("-").map(Number);
  for (let i = n - 1; i >= 0; i--) {
    let m = cm - i;
    let y = cy;
    while (m <= 0) { m += 12; y--; }
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }

  const results = [];
  for (const ym of months) {
    const ly = prevYear(ym);
    process.stdout.write(`  ${ym} vs ${ly}... `);
    const [cur, last] = await Promise.all([
      fetchMonthByDay(ym),
      fetchMonthByDay(ly),
    ]);
    const plan = last.total * 1.25;
    const pct = plan > 0 ? (cur.total / plan) * 100 : 0;
    console.log(`✓ ${Math.round(cur.total).toLocaleString()} THB (plan ${Math.round(plan).toLocaleString()}, ${pct.toFixed(0)}%)`);
    results.push({ ym, cur, last, plan, pct });
  }
  return results;
}

// ─── HTML generation ──────────────────────────────────────────────────────

function fmtTHB(n: number): string {
  return Math.round(n).toLocaleString("ru-RU") + " ฿";
}
function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

function generateHTML(
  currentYM: string,
  curData: Awaited<ReturnType<typeof fetchMonthByDay>>,
  lyData: Awaited<ReturnType<typeof fetchMonthByDay>>,
  monthlySummary: Awaited<ReturnType<typeof fetchMonthlySummary>>,
  todayDay: number,
  updatedAt: string
): string {
  const dim = daysInMonth(currentYM);
  const lyYM = prevYear(currentYM);
  const lyDim = daysInMonth(lyYM);

  const plan = lyData.total * 1.25;
  const progress = plan > 0 ? (curData.total / plan) * 100 : 0;
  const remaining = Math.max(0, plan - curData.total);
  const gpMargin = curData.total > 0 ? (curData.totalGP / curData.total) * 100 : 0;

  // Cumulative arrays
  const factArr = cumulativeArray(curData.byDay, dim, todayDay);
  const lyArr = cumulativeArray(lyData.byDay, lyDim, lyDim); // full LY month
  const planArr = Array.from({ length: dim }, (_, i) => {
    const lyVal = lyArr[i] ?? lyArr[lyArr.length - 1] ?? 0;
    return Math.round(lyVal * 1.25);
  });

  // Day labels
  const labels = Array.from({ length: dim }, (_, i) => i + 1);

  // Monthly table data
  const tableRows = monthlySummary.map(({ ym, cur, last, plan, pct }) => {
    const isCurrentMonth = ym === currentYM;
    const planAchievedClass = pct >= 100 ? "green" : pct >= 80 ? "orange" : "red";
    return `
      <tr class="${isCurrentMonth ? "current-row" : ""}">
        <td>${monthLabel(ym)}</td>
        <td class="num">${fmtTHB(cur.total)}</td>
        <td class="num">${fmtTHB(last.total)}</td>
        <td class="num">${fmtTHB(plan)}</td>
        <td class="num ${planAchievedClass}">${fmtPct(pct)}</td>
        <td class="num">${cur.checks}</td>
        <td class="num">${fmtPct(cur.total > 0 ? (cur.totalGP / cur.total) * 100 : 0)}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wine & Whiskey — Dashboard ${monthLabel(currentYM)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f4f0; color: #1a1a1a; }

  .header { background: #1a1a1a; color: #fff; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 20px; font-weight: 600; letter-spacing: -0.3px; }
  .header .updated { font-size: 12px; color: #888; }

  .kpi-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; background: #fff; border-bottom: 1px solid #e8e6e1; }
  .kpi-item { padding: 24px 28px; border-right: 1px solid #e8e6e1; }
  .kpi-item:last-child { border-right: none; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 8px; }
  .kpi-value { font-size: 32px; font-weight: 700; letter-spacing: -1px; color: #1a1a1a; }
  .kpi-value.accent { color: #7b1d1d; }
  .kpi-sub { font-size: 13px; color: #888; margin-top: 4px; }

  .progress-bar-wrap { height: 6px; background: #e8e6e1; border-radius: 3px; margin-top: 10px; overflow: hidden; }
  .progress-bar-fill { height: 100%; background: #7b1d1d; border-radius: 3px; transition: width 0.3s; }

  .main { display: grid; grid-template-columns: 1fr 380px; gap: 24px; padding: 24px 32px; max-width: 1400px; margin: 0 auto; }

  .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .card h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 20px; }

  .chart-container { position: relative; height: 340px; }

  .legend { display: flex; gap: 20px; margin-bottom: 16px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
  .legend-dot { width: 24px; height: 3px; border-radius: 2px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #888; text-align: left; padding: 8px 10px; border-bottom: 2px solid #e8e6e1; }
  td { padding: 10px 10px; border-bottom: 1px solid #f0eeea; vertical-align: middle; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.current-row td { background: #fdf9f7; font-weight: 600; }
  tr:hover td { background: #faf8f5; }
  .green { color: #15803d; }
  .orange { color: #b45309; }
  .red { color: #b91c1c; }

  .bottom { max-width: 1400px; margin: 0 auto; padding: 0 32px 32px; }

  @media (max-width: 900px) {
    .main { grid-template-columns: 1fr; }
    .kpi-bar { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>Wine & Whiskey — ${monthLabel(currentYM)}</h1>
  <span class="updated">Обновлено: ${updatedAt}</span>
</div>

<div class="kpi-bar">
  <div class="kpi-item">
    <div class="kpi-label">Факт</div>
    <div class="kpi-value accent">${fmtTHB(curData.total)}</div>
    <div class="kpi-sub">${curData.checks} чеков · GP ${fmtPct(gpMargin)}</div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width: ${Math.min(100, progress).toFixed(1)}%"></div>
    </div>
  </div>
  <div class="kpi-item">
    <div class="kpi-label">План (LY ×1.25)</div>
    <div class="kpi-value">${fmtTHB(plan)}</div>
    <div class="kpi-sub">Прошлый год: ${fmtTHB(lyData.total)}</div>
  </div>
  <div class="kpi-item">
    <div class="kpi-label">Выполнение</div>
    <div class="kpi-value ${progress >= 100 ? 'accent' : ''}">${fmtPct(progress)}</div>
    <div class="kpi-sub">Осталось: ${fmtTHB(remaining)}</div>
  </div>
  <div class="kpi-item">
    <div class="kpi-label">Gross Profit</div>
    <div class="kpi-value">${fmtTHB(curData.totalGP)}</div>
    <div class="kpi-sub">Маржа ${fmtPct(gpMargin)}</div>
  </div>
</div>

<div class="main">
  <div class="card">
    <h2>Прогресс к плану — день за днём</h2>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#7b1d1d;height:3px"></div> Факт ${currentYM.slice(0,4)}</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f97316;height:2px;border-top:2px dashed #f97316"></div> План</div>
      <div class="legend-item"><div class="legend-dot" style="background:#94a3b8;height:2px;border-top:2px dashed #94a3b8"></div> ${lyYM.slice(0,4)} (прошлый год)</div>
    </div>
    <div class="chart-container">
      <canvas id="progressChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Сводка по месяцам</h2>
    <table>
      <thead>
        <tr>
          <th>Месяц</th>
          <th style="text-align:right">Факт</th>
          <th style="text-align:right">LY</th>
          <th style="text-align:right">План</th>
          <th style="text-align:right">%</th>
          <th style="text-align:right">Чеков</th>
          <th style="text-align:right">GP%</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</div>

<script>
const labels = ${JSON.stringify(labels)};
const factData = ${JSON.stringify(factArr)};
const planData = ${JSON.stringify(planArr)};
const lyData = ${JSON.stringify(lyArr.slice(0, dim))};
const todayDay = ${todayDay};

const ctx = document.getElementById('progressChart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Факт',
        data: factData,
        borderColor: '#7b1d1d',
        backgroundColor: 'rgba(123,29,29,0.08)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        spanGaps: false,
      },
      {
        label: 'План',
        data: planData,
        borderColor: '#f97316',
        borderWidth: 2,
        borderDash: [6, 4],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
      {
        label: 'Прошлый год',
        data: lyData,
        borderColor: '#94a3b8',
        borderWidth: 1.5,
        borderDash: [4, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => \` \${ctx.dataset.label}: \${ctx.parsed.y?.toLocaleString('ru-RU')} ฿\`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: '#f0eeea' },
        ticks: { color: '#888', font: { size: 11 } },
        title: { display: true, text: 'День месяца', color: '#aaa', font: { size: 11 } },
      },
      y: {
        grid: { color: '#f0eeea' },
        ticks: {
          color: '#888',
          font: { size: 11 },
          callback: (v) => (v / 1000).toFixed(0) + 'k',
        },
        beginAtZero: true,
      },
    },
  },
});
</script>

</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  const now = bangkokNow();
  const currentYM = arg ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const lyYM = prevYear(currentYM);

  // Today's day-of-month in Bangkok (for cutting fact line)
  const [cy, cm] = currentYM.split("-").map(Number);
  const isCurrentMonth = now.getUTCFullYear() === cy && now.getUTCMonth() + 1 === cm;
  const todayDay = isCurrentMonth ? now.getUTCDate() : daysInMonth(currentYM);

  console.log(`\nWine & Whiskey — Dashboard Generator`);
  console.log(`Target month: ${monthLabel(currentYM)} | LY: ${monthLabel(lyYM)}\n`);

  console.log(`Fetching current month...`);
  const curData = await fetchMonthByDay(currentYM);
  console.log(`  ${curData.checks} receipts, ${Math.round(curData.total).toLocaleString()} THB\n`);

  console.log(`Fetching same month last year...`);
  const lyData = await fetchMonthByDay(lyYM);
  console.log(`  ${lyData.checks} receipts, ${Math.round(lyData.total).toLocaleString()} THB\n`);

  console.log(`Fetching monthly summary (last 6 months)...`);
  const monthlySummary = await fetchMonthlySummary(currentYM, 6);

  const updatedAt = now.toISOString().slice(0, 16).replace("T", " ") + " BKK";
  const html = generateHTML(currentYM, curData, lyData, monthlySummary, todayDay, updatedAt);

  const outDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `dashboard_${currentYM}.html`);
  fs.writeFileSync(outFile, html, "utf8");

  console.log(`\n✓ Dashboard saved: output/dashboard_${currentYM}.html`);
  console.log(`  Fact: ${Math.round(curData.total).toLocaleString()} THB | Plan: ${Math.round(lyData.total * 1.25).toLocaleString()} THB | Progress: ${((curData.total / (lyData.total * 1.25)) * 100).toFixed(1)}%\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
