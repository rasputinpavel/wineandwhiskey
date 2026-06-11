import type { ChartMonth, ProgressChartData, FactPlanMonth } from '@/lib/dashboard'

// Monthly charts ported from the Google-Sheet dashboard. Pure server-rendered
// SVG (no interactivity) — responsive via viewBox.

const W = 1040, H = 250, L = 38, R = 8, T = 14, B = 40
const PLOT_W = W - L - R
const PLOT_H = H - T - B
const BASE = T + PLOT_H

const COL = {
  retail: '#3f6cb0',
  b2b: '#d98a3d',
  gp: '#4a8c5f',
  fixed: '#8C1C1C',
  grid: '#D4C9BC',
  text: '#3D3D3D',
}

const k = (v: number) => Math.round(v / 1000).toLocaleString('en-US')

function niceMax(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * mag
}

function Grid({ max }: { max: number }) {
  const lines = [0, 0.25, 0.5, 0.75, 1]
  return (
    <g>
      {lines.map((f, i) => {
        const y = BASE - f * PLOT_H
        return (
          <g key={i}>
            <line x1={L} y1={y} x2={W - R} y2={y} stroke={COL.grid} strokeWidth={0.5} />
            <text x={L - 5} y={y + 3} textAnchor="end" fontSize={8} fill={COL.text}>{k(max * f)}</text>
          </g>
        )
      })}
    </g>
  )
}

function MonthLabels({ data, step }: { data: { ym: string; label: string; year: string }[]; step: number }) {
  return (
    <g>
      {data.map((m, i) => {
        const cx = L + i * step + step / 2
        const showYear = m.ym.endsWith('-01') || i === 0
        return (
          <g key={m.ym}>
            <text x={cx} y={BASE + 12} textAnchor="middle" fontSize={8} fill={COL.text}>{m.label}</text>
            {showYear && <text x={cx} y={BASE + 22} textAnchor="middle" fontSize={7} fill={COL.text}>{`20${m.year}`}</text>}
          </g>
        )
      })}
    </g>
  )
}

function Chart({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block" role="img">
      {children}
    </svg>
  )
}

// ─── Retail vs B2B (stacked) ──────────────────────────────────────────────────

export function RetailB2BChart({ data }: { data: ChartMonth[] }) {
  const max = niceMax(Math.max(1, ...data.map(m => m.total)))
  const step = PLOT_W / data.length
  const barW = step * 0.6
  const sc = (v: number) => (v / max) * PLOT_H
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-heading text-base text-deep-black">Retail vs B2B · monthly</h3>
        <span className="text-[11px] text-graphite"><span style={{ color: COL.retail }}>retail</span> + <span style={{ color: COL.b2b }}>B2B</span> · ฿ thousands</span>
      </div>
      <Chart>
        <Grid max={max} />
        {data.map((m, i) => {
          const x = L + i * step + (step - barW) / 2
          const rH = Math.max(0, sc(m.retail)), bH = Math.max(0, sc(m.b2b))
          const top = BASE - rH - bH
          return (
            <g key={m.ym}>
              <title>{`${m.label} 20${m.year}: retail ฿${k(m.retail)}k + B2B ฿${k(m.b2b)}k = ฿${k(m.total)}k`}</title>
              {rH > 0 && <rect x={x} y={BASE - rH} width={barW} height={rH} fill={COL.retail} />}
              {bH > 0 && <rect x={x} y={BASE - rH - bH} width={barW} height={bH} fill={COL.b2b} />}
              {m.total > 0 && <text x={x + barW / 2} y={top - 3} textAnchor="middle" fontSize={7.5} fill={COL.text}>{k(m.total)}</text>}
            </g>
          )
        })}
        <MonthLabels data={data} step={step} />
      </Chart>
    </section>
  )
}

// ─── Gross Profit vs Fixed (bars + line) ─────────────────────────────────────

export function GpFixedChart({ data }: { data: ChartMonth[] }) {
  const max = niceMax(Math.max(1, ...data.map(m => Math.max(m.gp, m.fixed))))
  const step = PLOT_W / data.length
  const barW = step * 0.6
  const sc = (v: number) => (v / max) * PLOT_H
  // Fixed line points (only where there is activity, so the line doesn't run
  // along future months with zero revenue baseline only).
  const pts = data.map((m, i) => `${L + i * step + step / 2},${BASE - sc(m.fixed)}`).join(' ')
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-heading text-base text-deep-black">Gross profit vs fixed costs · monthly</h3>
        <span className="text-[11px] text-graphite"><span style={{ color: COL.gp }}>GP</span> · <span style={{ color: COL.fixed }}>fixed + 1% of revenue</span> · ฿ thousands</span>
      </div>
      <Chart>
        <Grid max={max} />
        {data.map((m, i) => {
          const x = L + i * step + (step - barW) / 2
          const gH = Math.max(0, sc(m.gp))
          return (
            <g key={m.ym}>
              <title>{`${m.label} 20${m.year}: GP ฿${k(m.gp)}k · fixed ฿${k(m.fixed)}k`}</title>
              {gH > 0 && <rect x={x} y={BASE - gH} width={barW} height={gH} fill={COL.gp} />}
              {m.gp > 0 && <text x={x + barW / 2} y={BASE - gH - 3} textAnchor="middle" fontSize={7.5} fill={COL.text}>{k(m.gp)}</text>}
            </g>
          )
        })}
        <polyline points={pts} fill="none" stroke={COL.fixed} strokeWidth={1.5} strokeDasharray="4 3" />
        <MonthLabels data={data} step={step} />
      </Chart>
    </section>
  )
}

// ─── Cumulative month progress (fact vs LY vs plan, by day) ──────────────────

export function ProgressChart({ d }: { d: ProgressChartData }) {
  const { points, daysInMonth, todayDay, curLabel, lyLabel } = d
  const max = niceMax(Math.max(1, ...points.map(p => Math.max(p.ly, p.plan, p.fact ?? 0))))
  const xFor = (day: number) => L + (daysInMonth > 1 ? (day - 1) / (daysInMonth - 1) : 0) * PLOT_W
  const yFor = (v: number) => BASE - (v / max) * PLOT_H
  const line = (sel: (p: typeof points[number]) => number | null) =>
    points.filter(p => sel(p) != null).map(p => `${xFor(p.day)},${yFor(sel(p) as number)}`).join(' ')
  const ticks = [5, 10, 15, 20, 25, daysInMonth]
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-heading text-base text-deep-black">Plan progress · {curLabel}</h3>
        <span className="text-[11px] text-graphite"><span style={{ color: COL.fixed }}>fact</span> · <span style={{ color: COL.b2b }}>plan LY×1.25</span> · <span style={{ color: COL.grid }}>{lyLabel}</span> · cumulative ฿k</span>
      </div>
      <Chart>
        <Grid max={max} />
        <polyline points={line(p => p.plan)} fill="none" stroke={COL.b2b} strokeWidth={1.5} strokeDasharray="5 3" />
        <polyline points={line(p => p.ly)} fill="none" stroke="#9aa0a6" strokeWidth={1.2} strokeDasharray="1.5 2.5" />
        <polyline points={line(p => p.fact)} fill="none" stroke={COL.fixed} strokeWidth={2} />
        {ticks.map((t, i) => (
          <text key={i} x={xFor(t)} y={BASE + 14} textAnchor="middle" fontSize={8} fill={COL.text}>{t}</text>
        ))}
        <text x={L + PLOT_W / 2} y={BASE + 30} textAnchor="middle" fontSize={8} fill={COL.text}>day of month · {todayDay} elapsed</text>
      </Chart>
    </section>
  )
}

// ─── Monthly fact → plan (actual bars; LY+25% stacked for planned months) ────

export function FactPlanChart({ data }: { data: FactPlanMonth[] }) {
  const max = niceMax(Math.max(1, ...data.map(m => Math.max(m.base + m.increment, m.factLine ?? 0))))
  const step = PLOT_W / data.length
  const barW = step * 0.6
  const sc = (v: number) => (v / max) * PLOT_H
  const factPts = data.filter(m => m.factLine != null).map((m, _i) => {
    const idx = data.indexOf(m)
    return `${L + idx * step + step / 2},${BASE - sc(m.factLine as number)}`
  }).join(' ')
  return (
    <section className="bg-warm-white border border-pale-stone rounded-sm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-heading text-base text-deep-black">Monthly · fact → plan (LY+25% from Apr)</h3>
        <span className="text-[11px] text-graphite"><span style={{ color: COL.retail }}>actual / LY</span> + <span style={{ color: COL.b2b }}>+25%</span> · <span style={{ color: COL.fixed }}>2026 fact</span> · ฿k</span>
      </div>
      <Chart>
        <Grid max={max} />
        {data.map((m, i) => {
          const x = L + i * step + (step - barW) / 2
          const baseH = Math.max(0, sc(m.base)), incH = Math.max(0, sc(m.increment))
          const total = m.base + m.increment
          return (
            <g key={m.ym}>
              <title>{`${m.label} 20${m.year}: ${m.planned ? `LY ฿${k(m.base)}k + 25% ฿${k(m.increment)}k = plan ฿${k(total)}k${m.factLine != null ? ` · fact ฿${k(m.factLine)}k` : ''}` : `฿${k(m.base)}k`}`}</title>
              {baseH > 0 && <rect x={x} y={BASE - baseH} width={barW} height={baseH} fill={COL.retail} opacity={0.55} />}
              {incH > 0 && <rect x={x} y={BASE - baseH - incH} width={barW} height={incH} fill={COL.b2b} />}
              {total > 0 && <text x={x + barW / 2} y={BASE - baseH - incH - 3} textAnchor="middle" fontSize={7.5} fill={COL.text}>{k(total)}</text>}
            </g>
          )
        })}
        {factPts && <polyline points={factPts} fill="none" stroke={COL.fixed} strokeWidth={2} />}
        <MonthLabels data={data} step={step} />
      </Chart>
    </section>
  )
}
