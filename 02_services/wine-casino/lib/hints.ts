import { worldOf } from './categories'
import { countryOption, grapeOption } from './wine-data'
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

/** Ordered vaguest first: the opening hint should barely narrow the field, the
 *  last one should rescue a guest who is completely lost. */
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
    category: 'vintage',
    make: f => f.vintage
      ? {
          ru: `Год между ${f.vintage - 1} и ${f.vintage + 1}`,
          en: `Vintage between ${f.vintage - 1} and ${f.vintage + 1}`,
        }
      : null,
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
      const c = countryOption(f.country)
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
    make: f => {
      if (!f.region) return null
      const letter = f.region.trim()[0].toUpperCase()
      const country = f.country ? countryOption(f.country) : null
      return {
        ru: country ? `Регион: ${country.ru}, на букву ${letter}` : `Регион на букву ${letter}`,
        en: country ? `Region: ${country.en}, starts with ${letter}` : `Region starts with ${letter}`,
      }
    },
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
