import { worldOf } from './categories'
import { COUNTRIES, grapeOption } from './wine-data'
import type { CategoryKey, Difficulty, Hint, WineFacts } from './types'

// The schedule is written for a 120-second round and scaled from there, so a
// host can shorten rounds without the hints bunching up at the buzzer.
const BASE_ROUND_SECONDS = 120

export const HINT_SCHEDULE: Record<Difficulty, number[]> = {
  easy:   [90, 60, 30],
  medium: [60, 25],
  hard:   [25],
  pro:    [],
}

/**
 * Times are seconds REMAINING, so the list runs high to low.
 *
 * A hint inside the last five seconds cannot be acted on, and two hints landing
 * on the same tick waste one of them — clamping to a floor used to produce
 * [8, 5, 5] on a ten-second round. When a round is too short for the full
 * schedule, show fewer hints rather than stacking them at the buzzer.
 */
export function hintTimes(difficulty: Difficulty, roundSeconds: number): number[] {
  // Without this, a NaN round length makes every comparison below false, the
  // loop pushes NaN for every slot, and we are back to several hints landing on
  // the same (non-)tick.
  if (!Number.isFinite(roundSeconds) || roundSeconds <= 0) return []
  const out: number[] = []
  for (const t of HINT_SCHEDULE[difficulty]) {
    const scaled = Math.round((t / BASE_ROUND_SECONDS) * roundSeconds)
    const previous = out.length ? out[out.length - 1] : Infinity
    if (scaled < 5 || scaled >= previous) continue
    out.push(scaled)
  }
  return out
}

type Text = { ru: string; en: string }
type Generator = { category: CategoryKey; make: (f: WineFacts) => Text | null }

/** Ordered cheapest-category first, which also happens to run vaguest to most
 *  specific. The order is a balance decision, not a cosmetic one: a hint is free
 *  information, so whichever categories get hinted become the profitable places
 *  to bet. Hinting the cheap ones keeps the expensive ones honest.
 *
 *  Hints fill the earliest slots when fewer are available than the schedule has
 *  room for. That is deliberate — an early hint leaves the guest time to act on
 *  it, where a late one arrives as the clock runs out. */
const GENERATORS: Generator[] = [
  {
    category: 'world',
    make: f => {
      const w = worldOf(f.country)
      if (!w) return null
      return w === 'old'
        ? { ru: 'Это Старый Свет', en: 'This is the Old World' }
        : { ru: 'Это Новый Свет',  en: 'This is the New World' }
    },
  },
  {
    category: 'grape',
    make: f => {
      if (!f.grape) return null
      // A hint is stated as fact and guests bet chips on it. If the grape is
      // outside our pool AND the bottle's colour is unrecorded, we genuinely do
      // not know — skip rather than guess. (Kisi, a Georgian amber grape we
      // stock, used to be announced as red by a hardcoded fallback.)
      const g = grapeOption(f.grape, f.color)
      if (!g.group) return null
      return g.group === 'red'
        ? { ru: 'Сорт красный', en: 'The grape is red' }
        : { ru: 'Сорт белый',   en: 'The grape is white' }
    },
  },
  {
    category: 'country',
    make: f => {
      if (!f.country) return null
      // countryOption falls back to echoing the admin's raw text into BOTH
      // languages, so a country typed in Cyrillic would tell an English guest
      // "The country starts with И". Only hint at countries we have both
      // spellings for; skip the rest, as worldOf already does.
      const c = COUNTRIES.find(x => x.value === f.country!.trim().toLowerCase())
      if (!c) return null
      return {
        ru: `Страна начинается на букву ${c.ru.trim()[0].toUpperCase()}`,
        en: `The country starts with ${c.en.trim()[0].toUpperCase()}`,
      }
    },
  },
  {
    category: 'grape',
    // Grape names are printed in Latin on our shelf, so the initial is the same
    // letter in both languages.
    make: f => f.grape
      ? {
          ru: `Сорт начинается на букву ${f.grape.trim()[0].toUpperCase()}`,
          en: `The grape starts with ${f.grape.trim()[0].toUpperCase()}`,
        }
      : null,
  },
  {
    category: 'region',
    // The letter comes from the region string itself, which is also what the
    // board shows in both languages (our Russian regions are Cyrillic on the
    // bottle and on the button alike), so the hint and the board always agree.
    // The country name is only named when we hold both spellings.
    make: f => {
      if (!f.region) return null
      const letter = f.region.trim()[0].toUpperCase()
      const country = f.country
        ? COUNTRIES.find(x => x.value === f.country!.trim().toLowerCase()) ?? null
        : null
      return {
        ru: country ? `Регион: ${country.ru}, на букву ${letter}` : `Регион на букву ${letter}`,
        en: country ? `Region: ${country.en}, starts with ${letter}` : `Region starts with ${letter}`,
      }
    },
  },
  {
    // Last on purpose. Vintage pays x10 across ten buttons, and a plus/minus one
    // year hint cuts that to three — a return of roughly +2.3 chips per chip
    // staked for someone who never tasted the wine. Hinting it on every easy
    // round made "wait for the year hint and shove" the dominant strategy, which
    // is the opposite of what this game is for. It only fires now when the
    // cheaper generators above had nothing to say.
    category: 'vintage',
    make: f => f.vintage
      ? {
          ru: `Год между ${f.vintage - 1} и ${f.vintage + 1}`,
          en: `Vintage between ${f.vintage - 1} and ${f.vintage + 1}`,
        }
      : null,
  },
]

export function buildHints(
  facts: WineFacts,
  difficulty: Difficulty,
  roundSeconds: number,
  activeCategories: readonly CategoryKey[],
): Hint[] {
  const times = hintTimes(difficulty, roundSeconds)
  if (times.length === 0) return []

  const texts: Text[] = []
  for (const g of GENERATORS) {
    if (texts.length >= times.length) break
    if (!activeCategories.includes(g.category)) continue
    const t = g.make(facts)
    if (t) texts.push(t)
  }

  return texts.map((t, i) => ({ at: times[i], ru: t.ru, en: t.en }))
}
