import { getGameByPin } from '@/lib/db'
import { ScreenClient } from './ScreenClient'

export const dynamic = 'force-dynamic'

export default async function Screen({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params
  const game = await getGameByPin(pin)
  if (!game) {
    return <main className="flex min-h-screen items-center justify-center font-display text-4xl">No such game</main>
  }
  return <ScreenClient gameId={game.id} pin={game.pin} title={game.title} categories={game.categories} />
}
