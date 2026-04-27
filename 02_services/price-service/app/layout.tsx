import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Price Service — Wine & Whiskey',
  description: 'Supplier price list management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
