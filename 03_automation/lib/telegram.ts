/**
 * Minimal Telegram Bot API wrappers. Both functions report success as a boolean
 * instead of throwing: a digest half-sent is better than a digest lost.
 */

const API = 'https://api.telegram.org'

// A hung request — Instagram's CDN or Telegram going silent mid-connection,
// which `fetch` does not time out on its own — must not cost the whole digest
// by blocking until the CI job's own 30-minute limit kicks in.
const FETCH_TIMEOUT_MS = 15_000

/** Strip the bot token out of a string before it reaches the logs. */
function redact(token: string, text: string): string {
  return text.replaceAll(token, '[token]')
}

export async function sendMessage(token: string, chatId: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) console.error(`  ✗ sendMessage ${res.status}: ${redact(token, await res.text())}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendMessage failed:', redact(token, String(err)))
    return false
  }
}

/**
 * Download the image ourselves and upload the bytes. Instagram CDN URLs are
 * signed and Telegram's own fetch gets a 403 often enough to matter.
 */
export async function sendPhotoFromUrl(
  token:    string,
  chatId:   string,
  photoUrl: string,
  html:     string,
): Promise<boolean> {
  try {
    const img = await fetch(photoUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!img.ok) {
      console.error(`  ✗ thumbnail ${img.status} for ${photoUrl}`)
      return false
    }
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', html)
    form.append('parse_mode', 'HTML')
    form.append('photo', await img.blob(), 'thumb.jpg')

    const res = await fetch(`${API}/bot${token}/sendPhoto`, {
      method: 'POST',
      body:   form,
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) console.error(`  ✗ sendPhoto ${res.status}: ${redact(token, await res.text())}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendPhoto failed:', redact(token, String(err)))
    return false
  }
}
