// Shared SKU matcher. Used by:
//   - sync_inventory_flow.ts (live, when ingesting new FA invoice lines)
//   - rematch_unmapped.ts    (one-shot, to fix historical unmapped rows)
//
// Algorithm:
//   1. Tokenize both names. Volumes (0.7L / 0,7L / 70cl / 700ml) are
//      canonicalised to "vol<ml>" pseudo-tokens, so 0.7L vs 1L are kept
//      distinguishable.
//   2. Score = max(Jaccard, Containment).
//      - Jaccard punishes extra words on either side.
//      - Containment (inter / min) rewards "shorter is fully contained
//        in longer" — common when FA descriptions are wordier than
//        Loyverse names.
//   3. Token equality counts exact match OR Levenshtein-1 — typo
//      tolerance for "Palazzio" ≈ "Palazzo". Volumes and digit tokens
//      never fuzzy-match (vol700 ≠ vol1000).
//
// Threshold default 0.65 — tuned against current Wine & Whiskey data
// (99/100 unmapped → matched). Caller can override.

export type SkuLite = {
  id: string
  loyverse_product_code: string | null
  name: string
}

export type IndexedSku = SkuLite & { tokens: string[] }

const STOP = new Set(['bottle', 'btl', 'pcs', 'ea'])
const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(l|ml|cl)\b/gi

export function normalize(s: string): string[] {
  let str = s.toLowerCase()
  // Volume canonicalisation BEFORE punctuation strip — must catch the dot
  // in "0.7L" before it gets replaced by a space.
  str = str.replace(VOLUME_RE, (_m, num: string, unit: string) => {
    const n = Number(num.replace(',', '.'))
    const ml = unit === 'l' ? n * 1000 : unit === 'cl' ? n * 10 : n
    return ` vol${Math.round(ml)} `
  })
  str = str.replace(/[",.()&/\\:;]/g, ' ')
  const out: string[] = []
  for (const raw of str.split(/[\s'\-]+/)) {
    if (raw.length < 2) continue
    if (STOP.has(raw)) continue
    out.push(raw)
  }
  // Dedupe per side — multi-occurrence shouldn't bias score.
  return Array.from(new Set(out))
}

export function indexSkus(skus: SkuLite[]): IndexedSku[] {
  return skus.map(s => ({ ...s, tokens: normalize(s.name) }))
}

function isExactOnly(tok: string): boolean {
  return tok.startsWith('vol') || /^\d/.test(tok)
}

function lev1(a: string, b: string): boolean {
  if (a === b) return true
  if (isExactOnly(a) || isExactOnly(b)) return false
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length < 4 || b.length < 4) return false
  const m = a.length, n = b.length
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  let cur:  number[] = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > 1) return false
    const tmp = prev; prev = cur; cur = tmp
  }
  return prev[n] <= 1
}

function fuzzyInter(A: string[], B: string[]): number {
  const used = new Array<boolean>(B.length).fill(false)
  let inter = 0
  for (const a of A) {
    let hit = -1
    for (let i = 0; i < B.length; i++) {
      if (!used[i] && a === B[i]) { hit = i; break }
    }
    if (hit === -1) {
      for (let i = 0; i < B.length; i++) {
        if (!used[i] && lev1(a, B[i])) { hit = i; break }
      }
    }
    if (hit !== -1) { used[hit] = true; inter++ }
  }
  return inter
}

export function score(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const inter = fuzzyInter(a, b)
  const union = a.length + b.length - inter
  const jacc  = union === 0 ? 0 : inter / union
  const cont  = inter / Math.min(a.length, b.length)
  return Math.max(jacc, cont)
}

export type MatchOptions = { threshold?: number }
export type MatchResult = {
  sku: IndexedSku | null
  score: number
  runnerUp: { sku: IndexedSku; score: number } | null
}

// Find the best matching SKU for one raw text.
//   1. If raw text contains a known product code substring → instant match.
//   2. Otherwise score every SKU by token similarity, pick highest if
//      it's >= threshold.
export function matchSku(
  rawText: string,
  skus: IndexedSku[],
  opts: MatchOptions = {},
): MatchResult {
  const threshold = opts.threshold ?? 0.65

  // Direct product-code presence in the raw text.
  const lower = rawText.toLowerCase()
  for (const s of skus) {
    const code = s.loyverse_product_code?.toLowerCase()
    if (code && code.length >= 3 && lower.includes(code)) {
      return { sku: s, score: 1, runnerUp: null }
    }
  }

  const tokens = normalize(rawText)
  let best: IndexedSku | null = null
  let bestScore = 0
  let runnerUp: { sku: IndexedSku; score: number } | null = null

  for (const s of skus) {
    const sc = score(tokens, s.tokens)
    if (sc > bestScore) {
      if (best) runnerUp = { sku: best, score: bestScore }
      best = s
      bestScore = sc
    } else if (!runnerUp || sc > runnerUp.score) {
      runnerUp = { sku: s, score: sc }
    }
  }

  if (bestScore >= threshold && best) return { sku: best, score: bestScore, runnerUp }
  return { sku: null, score: bestScore, runnerUp }
}
