/**
 * The single answer to "are these the same string?" for anything a guest bets on.
 *
 * A wine's facts are typed by a human, the board is generated from dictionaries,
 * and the answer key is derived from the facts. All three must agree or a guest
 * taps the right button and is told they were wrong. Every comparison on that
 * path goes through here so there is one rule, not several that happen to match.
 */
export function canon(s: string): string {
  // Accents are folded too. Our own dictionaries carry ASCII keys next to
  // accented labels — `muller-thurgau` / `Müller-Thurgau`, `carmenere` /
  // `Carménère` — so without folding, a grape picked FROM OUR OWN LIST would
  // not match its own entry. Fold here rather than in the lookups, because
  // both halves of the money path must agree: the answer key and the board's
  // correct option are built separately and compared through this function.
  //
  // The result is only ever compared or stored as a key, never shown — labels
  // come from the ru/en fields — so folding is invisible to a guest.
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}
