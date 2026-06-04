// Утилиты для авто-матчинга b2b_customer (FlowAccount) → loyverse_customer.
//
// Имена в FA и LV редко совпадают точно (регистр, пробелы, суффиксы Co./Ltd,
// branch-suffixes в скобках). Используем токен-нормализацию + B2B-паттерны
// из общего модуля lib/b2b.ts (зеркало 03_automation/lib/b2b.ts).

import { B2B_PATTERNS as CLASSIFIER_PATTERNS } from './b2b'

const COMPANY_SUFFIX_RE = /\b(co|ltd|company|limited|inc|incorporated|corp|llc|cl)\b/g

export function normalizeName(name: string): { full: string; tokens: Set<string> } {
  const lower = String(name ?? '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')             // strip parens content (Branch 00001 → пусто)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')      // strip punctuation
    .replace(COMPANY_SUFFIX_RE, ' ')        // strip co/ltd/...
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = new Set(lower.split(' ').filter(t => t.length >= 2))
  return { full: lower, tokens }
}

// MATCH_ONLY_TOKENS — дополнительные паттерны, которые используются ТОЛЬКО для
// бонуса при матчинге FA↔Loyverse, но НЕ для классификации чеков. Многие из них
// (например «titov» — фамилия) безопасны при сравнении имён двух компаний, но
// в классификаторе чеков пометили бы физлицо как B2B, поэтому в lib/b2b.ts их нет.
// Реальные B2B-клиенты, найденные ручной разметкой; см. также b2b_overrides.ts.
const MATCH_ONLY_TOKENS: string[] = [
  'olabar', 'phuket kachatip', 'pinz', 'q squad', 'sukmesum', 'titov', 'volna pool',
]

// Полный набор паттернов для матчинга = каноничные классификаторные ∪ matching-only.
export const B2B_PATTERNS: string[] = [...CLASSIFIER_PATTERNS, ...MATCH_ONLY_TOKENS]

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = new Set([...a, ...b]).size
  return inter / union
}

export type MatchCandidate = { id: string; name: string; score: number; reason: string }

export function scoreCandidates(
  b2bName: string,
  lvCustomers: { id: string; name: string }[],
): MatchCandidate[] {
  const a = normalizeName(b2bName)
  const candidates: MatchCandidate[] = []
  for (const lv of lvCustomers) {
    const b = normalizeName(lv.name)
    let score = 0
    let reason = ''
    if (a.full && a.full === b.full) {
      score = 1.0
      reason = 'exact normalized match'
    } else {
      const j = jaccard(a.tokens, b.tokens)
      score = j
      reason = `jaccard ${j.toFixed(2)}`
      // Pattern bonus: if a known B2B_PATTERN fits both names → boost
      for (const p of B2B_PATTERNS) {
        if (a.full.includes(p) && b.full.includes(p)) {
          score = Math.max(score, 0.85)
          reason = `pattern «${p}»` + (j > 0 ? ` + jaccard ${j.toFixed(2)}` : '')
          break
        }
      }
    }
    if (score > 0) candidates.push({ id: lv.id, name: lv.name, score, reason })
  }
  return candidates.sort((x, y) => y.score - x.score)
}

export type AutoMatchResult = {
  b2bId: string
  b2bName: string
  applied: { lvId: string; lvName: string; score: number; reason: string } | null
  suggestions: MatchCandidate[]   // top-3 если ambiguous, пусто если applied или нет совпадений
}

/**
 * Решает: автолинковать (score ≥ MIN_AUTO и преимущество над #2 ≥ MIN_GAP)
 * или вернуть в suggestions для ручного выбора.
 */
const MIN_AUTO = 0.7
const MIN_GAP  = 0.15

export function decideMatch(b2bId: string, b2bName: string, candidates: MatchCandidate[]): AutoMatchResult {
  const top = candidates[0]
  const second = candidates[1]
  if (!top) return { b2bId, b2bName, applied: null, suggestions: [] }
  const gap = top.score - (second?.score ?? 0)
  if (top.score >= MIN_AUTO && (candidates.length === 1 || gap >= MIN_GAP)) {
    return {
      b2bId, b2bName,
      applied: { lvId: top.id, lvName: top.name, score: top.score, reason: top.reason },
      suggestions: [],
    }
  }
  return { b2bId, b2bName, applied: null, suggestions: candidates.slice(0, 3) }
}
