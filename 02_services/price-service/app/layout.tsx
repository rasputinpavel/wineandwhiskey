import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Price Service — Wine & Whiskey',
  description: 'Управление прайсами поставщиков · Wine & Whiskey',
}

export const viewport: Viewport = {
  themeColor: '#8C1C1C',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
