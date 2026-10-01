import 'server-only'
import * as db from './db'
import { settleRound } from './payout'
import { hintTimes } from './hints'
import type { PlacedBet } from './payout'
import type { Hint } from './types'

/**
 * Rewrites the public projection. Everything a phone knows about the game comes
 * from here, so anything not written here is, by construction, secret.
 */
async function publish(
  game: db.GameRow,
  wine: db.WineRow | null,
  wines: db.WineRow[],
  opts: { revealedHints?: Hint[] } = {},
): Promise<void> {
  const roundNo = wine ? wines.findIndex(w => w.id === wine.id) + 1 : 0
  const revealed = wine?.status === 'revealed'

  await db.upsertRoundState({
    game_id:      game.id,
    wine_id:      wine?.id ?? null,
    label:        wine?.label ?? null,
    game_status:  game.status,
    round_status: wine?.status ?? 'pending',
    round_no:     roundNo,
    total_rounds: wines.length,
    ends_at:      wine?.ends_at ?? null,
    options:      wine?.options ?? {},
    revealed_hints:   opts.revealedHints ?? [],
    revealed_answers: revealed ? (wine?.answers ?? null) : null,
    reveal: revealed && wine
      ? {
          name: wine.name, country: wine.country, region: wine.region,
          grape: wine.grape, vintage: wine.vintage, abv: wine.abv,
          style: wine.style, image_url: wine.image_url,
        }
      : null,
  })
}

/** Opens the doors: guests can join, no wine is poured yet. */
export async function openLobby(game: db.GameRow): Promise<void> {
  const updated = await db.updateGame(game.id, { status: 'lobby' })
  const wines = await db.listWines(game.id)
  await publish(updated, null, wines)
}

/** Starts betting on the game's current wine (or the first unplayed one). */
export async function startRound(game: db.GameRow): Promise<db.WineRow> {
  const wines = await db.listWines(game.id)
  if (wines.length === 0) throw new Error('game has no wines')

  const target =
    wines.find(w => w.id === game.current_wine_id) ??
    wines.find(w => w.status === 'pending') ??
    wines[0]

  // The button that leads here is disabled once a round is anything but
  // 'pending', but the API must not trust the button: a stale panel or a
  // replayed request must not be able to re-open a wine that already paid out.
  if (target.status === 'revealed') {
    throw new Error('wine already revealed; use Next wine instead')
  }

  // Last round's rescue notice is stale the moment a new wine is poured.
  await db.clearRescued(game.id)

  const endsAt = new Date(Date.now() + game.round_seconds * 1000).toISOString()
  const wine = await db.updateWine(target.id, {
    status: 'betting',
    started_at: new Date().toISOString(),
    ends_at: endsAt,
  })

  const updatedGame = await db.updateGame(game.id, { status: 'running', current_wine_id: wine.id })
  await publish(updatedGame, wine, wines.map(w => (w.id === wine.id ? wine : w)), { revealedHints: [] })
  return wine
}

/**
 * Reveals every hint whose moment has passed. Called from the host panel every
 * two seconds — the host's browser is the clock. Nothing else ticks, so a
 * closed host panel simply means no new hints, never a stuck round.
 */
export async function tickHints(
  game: db.GameRow,
  prefetched?: db.RoundStateRow | null,
): Promise<{ hints: Hint[]; state: db.RoundStateRow | null }> {
  // `/api/state` has already loaded the row; re-reading it here cost a round
  // trip on every guest's poll for nothing.
  const state = prefetched !== undefined ? prefetched : await db.getRoundState(game.id)
  if (!state || state.round_status !== 'betting' || !state.wine_id || !state.ends_at) {
    return { hints: state?.revealed_hints ?? [], state }
  }

  const remaining = (new Date(state.ends_at).getTime() - Date.now()) / 1000

  // The schedule is pure: difficulty and round length give the hint times with
  // no database at all. Only reach for the wine when the clock says another
  // hint is genuinely due — on the overwhelming majority of ticks it is not,
  // and this is the hot path every phone in the room walks every few seconds.
  const dueByClock = hintTimes(game.difficulty, game.round_seconds)
    .filter(at => remaining <= at).length
  if (dueByClock <= state.revealed_hints.length) {
    return { hints: state.revealed_hints, state }
  }

  const wine = await db.getWine(state.wine_id)
  if (!wine) return { hints: state.revealed_hints, state }

  const due = wine.hints.filter(h => remaining <= h.at)
  if (due.length === state.revealed_hints.length) {
    return { hints: state.revealed_hints, state }
  }

  // Conditional on the wine we read: a tick that started against the old
  // round must not win a race against Start and paste stale hints onto the
  // new one. See db.appendHintsIfCurrent.
  await db.appendHintsIfCurrent(game.id, wine.id, due)
  return { hints: due, state: { ...state, revealed_hints: due } }
}

/** Closes betting without revealing anything yet. */
export async function lockRound(game: db.GameRow): Promise<void> {
  if (!game.current_wine_id) return
  const wine = await db.updateWine(game.current_wine_id, { status: 'locked' })
  const wines = await db.listWines(game.id)
  const state = await db.getRoundState(game.id)
  await publish(game, wine, wines, { revealedHints: state?.revealed_hints ?? [] })
}

export type RevealSummary = {
  wine: db.WineRow
  players: Array<{ id: string; nickname: string; chipsBefore: number; chipsAfter: number; staked: number; won: number; rescued: boolean }>
}

/** Settles the round: the only place chips ever move. */
export async function revealRound(game: db.GameRow): Promise<RevealSummary> {
  if (!game.current_wine_id) throw new Error('no current wine')

  // Claim the round before reading any bets. The status IS the lock: a second
  // Reveal — a mis-tapped button, a retried request, a second host device —
  // finds nothing to claim and returns the settlement already on file rather
  // than paying everyone a second time out of their new balances.
  const wine = await db.claimWineForReveal(game.current_wine_id)
  if (!wine) {
    // Already revealed. Report what was settled, do not settle again.
    const existing = await db.getWine(game.current_wine_id)
    if (!existing) throw new Error('current wine missing')
    const players = await db.listPlayers(game.id)
    return {
      wine: existing,
      players: players.map(p => ({
        id: p.id, nickname: p.nickname,
        chipsBefore: p.chips, chipsAfter: p.chips,
        staked: 0, won: 0, rescued: p.rescued,
      })),
    }
  }

  const [players, betRows] = await Promise.all([
    db.listPlayers(game.id),
    db.listBetsForWine(wine.id),
  ])

  const placed: PlacedBet[] = betRows.map(b => ({
    id: b.id, playerId: b.player_id, category: b.category, option: b.option, amount: b.amount,
  }))

  const result = settleRound({
    bets: placed,
    answers: wine.answers,
    categories: game.categories,
    players: players.map(p => ({ id: p.id, chips: p.chips })),
    rescueChips: game.rescue_chips,
  })

  // Each settled bet carries its own casino.bet.id, so nothing here depends on
  // the arrays still lining up.
  await Promise.all(
    result.bets.map(b => db.saveBetOutcome(b.id, b.isCorrect, b.payout)),
  )

  // Publish the reveal *before* moving any chips. Both phones and the TV
  // subscribe to casino.player, so if the chips moved first, the leaderboard
  // would visibly reshuffle a beat before the bottle appears — telling a
  // guest whether they won before the host says a word. The wine's status is
  // already 'revealed' (the claim above did that), so this projection is the
  // real reveal moment.
  const wines = await db.listWines(game.id)
  const state = await db.getRoundState(game.id)
  await publish(game, wine, wines, { revealedHints: state?.revealed_hints ?? [] })

  await Promise.all(result.players.map(p => db.settlePlayer(p.id, p.chipsAfter, p.rescued)))

  const byId = new Map(players.map(p => [p.id, p.nickname]))
  return {
    wine,
    players: result.players.map(p => ({ ...p, nickname: byId.get(p.id) ?? '?' })),
  }
}

/** Moves to the next wine, or ends the game if this was the last one. */
export async function nextWine(game: db.GameRow): Promise<db.WineRow | null> {
  const wines = await db.listWines(game.id)
  const idx = wines.findIndex(w => w.id === game.current_wine_id)
  const next = idx >= 0 ? wines[idx + 1] : wines[0]

  if (!next) {
    const finished = await db.updateGame(game.id, { status: 'finished', current_wine_id: null })
    await publish(finished, null, wines)
    return null
  }

  const updated = await db.updateGame(game.id, { current_wine_id: next.id })
  await publish(updated, next, wines, { revealedHints: [] })
  return next
}
