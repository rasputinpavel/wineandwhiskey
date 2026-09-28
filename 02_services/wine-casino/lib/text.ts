/**
 * The single answer to "are these the same string?" for anything a guest bets on.
 *
 * A wine's facts are typed by a human, the board is generated from dictionaries,
 * and the answer key is derived from the facts. All three must agree or a guest
 * taps the right button and is told they were wrong. Every comparison on that
 * path goes through here so there is one rule, not several that happen to match.
 */
export function canon(s: string): string {
  return s.trim().toLowerCase()
}
