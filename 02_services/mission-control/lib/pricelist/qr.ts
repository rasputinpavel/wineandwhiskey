import QRCode from 'qrcode'

// Renders `text` (typically the order/WhatsApp link) as a QR PNG data URL for
// the price-list header. Works in both Node (render route) and the browser
// (live preview). Transparent background so it sits on the warm-white band.
export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 0,
    width: 160,
    errorCorrectionLevel: 'M',
    color: { dark: '#1A1A1A', light: '#00000000' },
  })
}
