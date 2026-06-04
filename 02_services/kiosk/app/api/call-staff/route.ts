import { NextRequest, NextResponse } from 'next/server'

// Posts a "customer needs help" alert to the staff Telegram chat. Configured
// via env so the kiosk doesn't carry secrets at build time:
//   TELEGRAM_BOT_TOKEN — the bot in 01_agents/bot
//   TELEGRAM_STAFF_CHAT_ID — group chat or staff DM
// If either is missing we log and 200 — the UI still shows "notified" so a
// missing env doesn't break the kiosk flow during setup.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { path?: string }
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat  = process.env.TELEGRAM_STAFF_CHAT_ID
  if (!token || !chat) {
    console.warn('[call-staff] missing TELEGRAM_BOT_TOKEN or TELEGRAM_STAFF_CHAT_ID; skipping send')
    return NextResponse.json({ ok: true, skipped: true })
  }

  const where = body.path ? ` (${body.path})` : ''
  const text  = `🛎 Customer at kiosk needs help${where}`
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    })
  } catch (e) {
    console.error('[call-staff] telegram send failed', e)
  }
  return NextResponse.json({ ok: true })
}
