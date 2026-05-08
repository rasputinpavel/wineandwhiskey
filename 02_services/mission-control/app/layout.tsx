import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'W&W Mission Control',
  description: 'Wine & Whiskey — operational bridge',
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
