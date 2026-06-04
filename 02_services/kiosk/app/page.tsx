import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-between p-12 bg-warm-white">
      <header className="pt-8 text-center">
        <div className="font-display text-7xl tracking-display text-deep-black leading-none">
          WINE &amp; WHISKEY
        </div>
        <div className="overline mt-4 text-graphite">Phuket · Since 2024</div>
      </header>

      <div className="w-full max-w-xl flex flex-col gap-6">
        <Link
          href="/wizard"
          className="h-48 rounded-lg bg-wine-red text-warm-white flex flex-col items-center justify-center active:bg-burgundy-deep"
        >
          <div className="font-display text-6xl tracking-display">HELP ME CHOOSE</div>
          <div className="mt-2 font-sans text-xl opacity-90">4 questions · 30 seconds</div>
        </Link>

        <Link
          href="/catalog"
          className="h-48 rounded-lg border-2 border-deep-black text-deep-black flex flex-col items-center justify-center active:bg-cream"
        >
          <div className="font-display text-6xl tracking-display">BROWSE CATALOG</div>
          <div className="mt-2 font-sans text-xl text-graphite">Filter by type, country, price</div>
        </Link>
      </div>

      <footer className="overline text-graphite">Touch the screen to start</footer>
    </div>
  )
}
