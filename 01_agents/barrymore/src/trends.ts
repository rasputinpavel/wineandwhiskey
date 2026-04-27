// Trend digest notifications from the trendwatch service

const BOT_TOKEN = process.env.BARRYMORE_BOT_TOKEN!
const CHAT_ID = process.env.BARRYMORE_CHAT_ID
  ?? process.env.NOTIFY_CHAT_IDS?.split(',')[0]?.trim()
  ?? null

const SERVICE_URL = process.env.TRENDWATCH_URL || 'https://trendwatch.railway.app'

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export async function sendTrendDigest(
  reels: Array<{ username: string; views: number; url: string }>
): Promise<void> {
  if (!CHAT_ID || !reels.length) return

  const top3 = reels.slice(0, 3)
  const lines = top3.map((r, i) =>
    `${i + 1}. @${r.username} — <b>${fmtViews(r.views)} просмотров</b>\n   <a href="${r.url}">смотреть рилс</a>`
  )

  const total = reels.length
  const text = [
    `📈 <b>Тренды за сегодня</b>`,
    `Найдено ${total} рилс${total === 1 ? '' : 'ов'} с охватом >50 000`,
    '',
    ...lines,
    '',
    `<a href="${SERVICE_URL}/discover">Открыть тренд-вотчинг →</a>`,
  ].join('\n')

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  })
}

export async function sendVideoReady(briefId: string, reelUrl: string): Promise<void> {
  if (!CHAT_ID) return

  const text = [
    `🎬 <b>Видео готово</b>`,
    `Runway сгенерировал рилс по брифу.`,
    `<a href="${SERVICE_URL}/brief/${briefId}">Открыть бриф и скачать →</a>`,
  ].join('\n')

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  })
}
