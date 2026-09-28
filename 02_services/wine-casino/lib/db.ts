import 'server-only'
import { sbCasino, sbInventory } from './supabase'
import type {
  CategoryDef, CategoryKey, Difficulty, GameStatus, Hint,
  OptionSet, RoundStatus, WineAnswers, WineColor, WineFacts,
} from './types'

export type GameRow = {
  id: string
  pin: string
  host_token: string
  title: string
  status: GameStatus
  difficulty: Difficulty
  starting_chips: number
  rescue_chips: number
  round_seconds: number
  categories: CategoryDef[]
  current_wine_id: string | null
  created_at: string
}

export type WineRow = {
  id: string
  game_id: string
  order_no: number
  label: string
  sku: string | null
  name: string
  country: string | null
  region: string | null
  grape: string | null
  vintage: number | null
  style: string | null
  color: WineColor | null
  abv: number | null
  image_url: string | null
  answers: WineAnswers
  options: OptionSet
  hints: Hint[]
  status: RoundStatus
  started_at: string | null
  ends_at: string | null
}

export type PlayerRow = {
  id: string
  game_id: string
  nickname: string
  chips: number
  lang: 'ru' | 'en'
  /** True for the round in which the house staked this guest after they busted. */
  rescued: boolean
  joined_at: string
}

export type BetRow = {
  id: string
  game_id: string
  wine_id: string
  player_id: string
  category: CategoryKey
  option: string
  amount: number
  is_correct: boolean | null
  payout: number | null
  created_at: string
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

// --- games -----------------------------------------------------------------

export async function getGameByPin(pin: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('pin', pin).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function getGameByHostToken(token: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('host_token', token).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function getGame(id: string): Promise<GameRow | null> {
  const { data, error } = await sbCasino.from('game').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as GameRow | null
}

export async function listGames(): Promise<GameRow[]> {
  return unwrap(await sbCasino.from('game').select('*').order('created_at', { ascending: false }))
}

export async function insertGame(row: Partial<GameRow>): Promise<GameRow> {
  return unwrap(await sbCasino.from('game').insert(row).select().single())
}

export async function updateGame(id: string, patch: Partial<GameRow>): Promise<GameRow> {
  return unwrap(await sbCasino.from('game').update(patch).eq('id', id).select().single())
}

export async function deleteGame(id: string): Promise<void> {
  const { error } = await sbCasino.from('game').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// --- wines -----------------------------------------------------------------

export async function listWines(gameId: string): Promise<WineRow[]> {
  return unwrap(
    await sbCasino.from('game_wine').select('*').eq('game_id', gameId).order('order_no'),
  )
}

export async function getWine(id: string): Promise<WineRow | null> {
  const { data, error } = await sbCasino.from('game_wine').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as WineRow | null
}

export async function insertWine(row: Partial<WineRow>): Promise<WineRow> {
  return unwrap(await sbCasino.from('game_wine').insert(row).select().single())
}

export async function updateWine(id: string, patch: Partial<WineRow>): Promise<WineRow> {
  return unwrap(await sbCasino.from('game_wine').update(patch).eq('id', id).select().single())
}

export async function deleteWine(id: string): Promise<void> {
  const { error } = await sbCasino.from('game_wine').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Atomically flips a wine from betting/locked to revealed. The status IS the
 * lock: a second caller — a mis-tapped button, a retried request, a second
 * host device — finds nothing left in those statuses and gets `null` back,
 * instead of a row it can go on to settle a second time.
 */
export async function claimWineForReveal(id: string): Promise<WineRow | null> {
  const { data, error } = await sbCasino.from('game_wine')
    .update({ status: 'revealed' })
    .eq('id', id)
    .in('status', ['betting', 'locked'])
    .select()
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as WineRow | null
}

// --- players ---------------------------------------------------------------

export async function listPlayers(gameId: string): Promise<PlayerRow[]> {
  return unwrap(
    await sbCasino.from('player').select('*').eq('game_id', gameId).order('joined_at'),
  )
}

export async function getPlayer(id: string): Promise<PlayerRow | null> {
  const { data, error } = await sbCasino.from('player').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as PlayerRow | null
}

export async function insertPlayer(row: Partial<PlayerRow>): Promise<PlayerRow> {
  return unwrap(await sbCasino.from('player').insert(row).select().single())
}

/** The one write that moves a guest's money. `rescued` rides along because the
 *  phone has no other way to explain a jump from nothing back to ten chips. */
export async function settlePlayer(id: string, chips: number, rescued: boolean): Promise<void> {
  const { error } = await sbCasino.from('player').update({ chips, rescued }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Clears last round's rescue notices when a new round opens. */
export async function clearRescued(gameId: string): Promise<void> {
  const { error } = await sbCasino.from('player')
    .update({ rescued: false }).eq('game_id', gameId).eq('rescued', true)
  if (error) throw new Error(error.message)
}

export async function savePlayerSecret(playerId: string, tokenHash: string): Promise<void> {
  const { error } = await sbCasino.from('player_secret')
    .upsert({ player_id: playerId, token_hash: tokenHash })
  if (error) throw new Error(error.message)
}

export async function getPlayerSecret(playerId: string): Promise<string | null> {
  const { data, error } = await sbCasino.from('player_secret')
    .select('token_hash').eq('player_id', playerId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { token_hash: string } | null)?.token_hash ?? null
}

// --- bets ------------------------------------------------------------------

export async function listBetsForWine(wineId: string): Promise<BetRow[]> {
  return unwrap(await sbCasino.from('bet').select('*').eq('wine_id', wineId))
}

export async function listBetsForPlayerWine(playerId: string, wineId: string): Promise<BetRow[]> {
  return unwrap(
    await sbCasino.from('bet').select('*').eq('player_id', playerId).eq('wine_id', wineId),
  )
}

/** Replace-semantics: the phone always sends its whole slip. */
export async function replaceBets(
  playerId: string,
  wineId: string,
  rows: Array<Pick<BetRow, 'game_id' | 'wine_id' | 'player_id' | 'category' | 'option' | 'amount'>>,
): Promise<void> {
  const del = await sbCasino.from('bet').delete().eq('player_id', playerId).eq('wine_id', wineId)
  if (del.error) throw new Error(del.error.message)
  if (rows.length === 0) return
  const ins = await sbCasino.from('bet').insert(rows)
  if (ins.error) throw new Error(ins.error.message)
}

export async function saveBetOutcome(id: string, isCorrect: boolean | null, payout: number): Promise<void> {
  const { error } = await sbCasino.from('bet')
    .update({ is_correct: isCorrect, payout }).eq('id', id)
  if (error) throw new Error(error.message)
}

// --- round_state -----------------------------------------------------------

export type RoundStateRow = {
  game_id: string
  wine_id: string | null
  label: string | null
  game_status: GameStatus
  round_status: RoundStatus
  round_no: number
  total_rounds: number
  ends_at: string | null
  options: OptionSet
  revealed_hints: Hint[]
  revealed_answers: WineAnswers | null
  reveal: Record<string, unknown> | null
  updated_at: string
}

export async function getRoundState(gameId: string): Promise<RoundStateRow | null> {
  const { data, error } = await sbCasino.from('round_state')
    .select('*').eq('game_id', gameId).maybeSingle()
  if (error) throw new Error(error.message)
  return data as RoundStateRow | null
}

export async function upsertRoundState(row: Partial<RoundStateRow> & { game_id: string }): Promise<void> {
  const { error } = await sbCasino.from('round_state')
    .upsert({ ...row, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

/**
 * Writes hints only if the row still points at the wine we read them for.
 * `tickHints` runs for every polling phone with no version check across its
 * read-then-write, so a tick that started against the old wine must not be
 * allowed to paste stale hints onto the new one after the host presses Start.
 */
export async function appendHintsIfCurrent(
  gameId: string, wineId: string, hints: Hint[],
): Promise<void> {
  const { error } = await sbCasino.from('round_state')
    .update({ revealed_hints: hints, updated_at: new Date().toISOString() })
    .eq('game_id', gameId)
    .eq('wine_id', wineId)
  if (error) throw new Error(error.message)
}

// --- inventory search --------------------------------------------------------

export type InventoryHit = {
  sku_id: string
  name: string
  wine_color: WineColor | null
  grape_variety: string | null
  wine_country: string | null
}

/** Feeds the admin's wine picker. v_sku_breakdown carries colour, grape and
 *  country but no region or vintage — those are always typed in by hand. */
export async function searchInventory(q: string, limit = 20): Promise<InventoryHit[]> {
  const { data, error } = await sbInventory
    .from('v_sku_breakdown')
    .select('sku_id,name,wine_color,grape_variety,wine_country')
    .ilike('name', `%${q}%`)
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as InventoryHit[]
}

/** Everything the generators need, assembled from a stored wine row. */
export function factsOf(w: WineRow): WineFacts {
  return {
    name: w.name, country: w.country, region: w.region, grape: w.grape,
    vintage: w.vintage, style: w.style, color: w.color, abv: w.abv,
  }
}
