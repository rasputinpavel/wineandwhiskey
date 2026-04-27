import type { TrendReel } from './supabase'

const BOT_TOKEN = process.env.BARRYMORE_BOT_TOKEN!
const CHAT_ID = process.env.BARRYMORE_CHAT_ID!
const SERVICE_URL = process.env.TRENDWATCH_URL || 'http://localhost:3002'

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

async function sendMessage(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[barrymore] skipping notify — token/chat not configured')
    return
  }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  })
}

export async function notifyTrendDigest(reels: TrendReel[]): Promise<void> {
  if (!reels.length) return

  const top3 = reels.slice(0, 3)

  const lines = top3.map((r, i) => {
    const views = formatNumber(r.views_count)
    const account = r.trend_accounts?.username ?? 'unknown'
    return `${i + 1}. @${account} — <b>${views} views</b>\n   <a href="${r.url ?? '#'}">смотреть рилс</a>`
  })

  const total = reels.length
  const msg = [
    `📈 <b>Новые тренды</b>: найдено ${total} рилс${total === 1 ? '' : 'ов'} >50K просмотров`,
    '',
    ...lines,
    '',
    `<a href="${SERVICE_URL}/discover">Открыть тренд-вотчинг →</a>`,
  ].join('\n')

  await sendMessage(msg)
}

export async function notifyVideoReady(briefId: string, videoUrl: string): Promise<void> {
  const msg = [
    `🎬 <b>Видео готово</b>`,
    `Runway сгенерировал рилс по брифу.`,
    `<a href="${SERVICE_URL}/brief/${briefId}">Открыть бриф →</a>`,
  ].join('\n')
  await sendMessage(msg)
}
