import './globals.css'
import type { Metadata, Viewport } from 'next'
import { IdleReset } from '@/components/IdleReset'
import { CallStaffButton } from '@/components/CallStaffButton'

export const metadata: Metadata = {
  title: 'Wine & Whiskey — Sommelier',
  // Block search engines — kiosk URL is internal.
  robots: { index: false, follow: false },
}

// Designed for 27" portrait 1080x1920. No pinch-zoom, no scaling.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#F5F0EB',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <main className="flex-1 flex flex-col">{children}</main>
        <CallStaffButton />
        <IdleReset timeoutSec={60} />
      </body>
    </html>
  )
}
