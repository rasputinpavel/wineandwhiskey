import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trendwatch — Wine & Whiskey',
  description: 'Instagram Reels trend monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
