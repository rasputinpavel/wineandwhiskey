import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Wine Casino — Wine & Whiskey',
  robots: { index: false, follow: false },
}

// Phones in a dim room. No pinch-zoom: the betting grid is already thumb-sized
// and an accidental zoom mid-round costs the guest the round.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#14342B',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
