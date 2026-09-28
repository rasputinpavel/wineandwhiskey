const MAX_NICK = 24

/** Six digits, never leading zero: guests drop leading zeros when typing. */
export function generatePin(rng: () => number = Math.random): string {
  return String(100000 + Math.floor(rng() * 900000))
}

/** `casino.player` has a unique (game_id, nickname) index — resolve collisions
 *  here rather than bouncing the guest back to the form. */
export function uniqueNickname(desired: string, taken: readonly string[]): string {
  const base = desired.trim().slice(0, MAX_NICK) || 'Гость'
  const used = new Set(taken.map(t => t.trim().toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (${n})`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return `${base} (${Date.now() % 1000})`
}
