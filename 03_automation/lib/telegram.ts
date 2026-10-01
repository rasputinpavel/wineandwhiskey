/**
 * Minimal Telegram Bot API wrappers. Both functions report success as a boolean
 * instead of throwing: a digest half-sent is better than a digest lost.
 */

const API = 'https://api.telegram.org'

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
    })
    if (!res.ok) console.error(`  ✗ sendMessage ${res.status}: ${await res.text()}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendMessage failed:', err)
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
    const img = await fetch(photoUrl)
    if (!img.ok) {
      console.error(`  ✗ thumbnail ${img.status} for ${photoUrl}`)
      return false
    }
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', html)
    form.append('parse_mode', 'HTML')
    form.append('photo', await img.blob(), 'thumb.jpg')

    const res = await fetch(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form })
    if (!res.ok) console.error(`  ✗ sendPhoto ${res.status}: ${await res.text()}`)
    return res.ok
  } catch (err) {
    console.error('  ✗ sendPhoto failed:', err)
    return false
  }
}
