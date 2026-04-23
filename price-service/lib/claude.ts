import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ExtractedItem = {
  name: string
  country: string | null
  region: string | null
  grape_variety: string | null
  price: number | null
  year: number | null
  volume: string | null
  description: string | null
}

export type ExtractionResult = {
  supplier_name: string
  price_list_date: string | null
  currency: string | null
  items: ExtractedItem[]
}

// ─── Prompts ────────────────────────────────────────────────────────────────

const META_PROMPT = `From this supplier wine/spirits price list (may be CSV, Excel data, or text), extract ONLY the supplier/company name and date.
The supplier name is usually in the first few rows or in the filename/sheet name context.
Return ONLY this JSON (no markdown, no other text):
{"supplier_name":"actual company name or Unknown Supplier","price_list_date":"YYYY-MM-DD or null","currency":"THB or USD or null"}`

const ITEMS_PROMPT = `This is a wine/spirits supplier price list in CSV or text format. Extract ALL wine and spirits items.
Each row typically has: product name, price, possibly country/region/grape/year/volume.
Return ONLY a compact JSON array (no markdown, no explanation):
[{"name":"...","country":"...or null","region":"...or null","grape_variety":"...or null","price":number or null,"year":integer or null,"volume":"...or null","description":"...or null"}]
Skip header rows, totals, and non-product rows. If no items found, return [].`

const FULL_PROMPT = `This is a wine/spirits supplier price list (may be CSV from Excel, plain text, or an image/PDF).
Extract the supplier name (usually at top or in sheet name) and ALL wine/spirits product rows.
Return ONLY this JSON (no markdown):
{"supplier_name":"actual company name or Unknown Supplier","price_list_date":"YYYY-MM-DD or null","currency":"THB/USD/null","items":[{"name":"...","country":"...or null","region":"...or null","grape_variety":"...or null","price":number or null,"year":integer or null,"volume":"...or null","description":"...or null"}]}
Skip header rows, totals, category headers. Return [] for items if none found.`

// ─── Helpers ─────────────────────────────────────────────────────────────────

type DocBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
type ImgBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()) as T
  } catch {
    return null
  }
}

async function callWithPdf(prompt: string, pdfBase64: string): Promise<string> {
  const doc: DocBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: [doc as unknown as Anthropic.TextBlockParam, { type: 'text', text: prompt }] }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function callWithImage(prompt: string, imageBase64: string, mimeType: string): Promise<string> {
  const img: ImgBlock = { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } }
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: [img as unknown as Anthropic.TextBlockParam, { type: 'text', text: prompt }] }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

async function callWithText(prompt: string, text: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: `${prompt}\n\n<price_list>\n${text}\n</price_list>` }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

// ─── Extractors ──────────────────────────────────────────────────────────────

/** PDF: split into page-chunks and extract */
export async function extractFromChunks(pdfChunks: string[]): Promise<ExtractionResult> {
  const metaRaw = await callWithPdf(META_PROMPT, pdfChunks[0])
  const meta = parseJson<Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'>>(metaRaw)
    ?? { supplier_name: 'Unknown Supplier', price_list_date: null, currency: null }

  const allItems: ExtractedItem[] = []
  for (let i = 0; i < pdfChunks.length; i += 5) {
    const batch = pdfChunks.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(async (chunk, j) => {
        const raw = await callWithPdf(ITEMS_PROMPT, chunk)
        console.log(`[claude] chunk ${i + j + 1}/${pdfChunks.length} → ${raw.slice(0, 60)}`)
        return parseJson<ExtractedItem[]>(raw) ?? []
      })
    )
    results.forEach(items => allItems.push(...items))
  }

  const unique = dedup(allItems)
  console.log(`[claude] total items: ${unique.length}`)
  return { supplier_name: meta.supplier_name || 'Unknown', price_list_date: meta.price_list_date ?? null, currency: meta.currency ?? null, items: unique }
}

/** Batch of page images rendered from PDF — extract all items across pages */
export async function extractFromImageBatch(pageImages: string[]): Promise<ExtractionResult> {
  // Get meta from first page
  const metaRaw = await callWithImage(META_PROMPT, pageImages[0], 'image/jpeg')
  const meta = parseJson<Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'>>(metaRaw)
    ?? { supplier_name: 'Unknown Supplier', price_list_date: null, currency: null }
  console.log(`[claude] image batch meta: ${meta.supplier_name}`)

  const allItems: ExtractedItem[] = []
  for (let i = 0; i < pageImages.length; i += 5) {
    const batch = pageImages.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(async (img, j) => {
        const raw = await callWithImage(ITEMS_PROMPT, img, 'image/jpeg')
        console.log(`[claude] page ${i + j + 1}/${pageImages.length} → ${raw.slice(0, 60)}`)
        return parseJson<ExtractedItem[]>(raw) ?? []
      })
    )
    results.forEach(items => allItems.push(...items))
  }

  const unique = dedup(allItems)
  console.log(`[claude] image batch total items: ${unique.length}`)
  return { supplier_name: meta.supplier_name || 'Unknown Supplier', price_list_date: meta.price_list_date ?? null, currency: meta.currency ?? null, items: unique }
}

/** Image (JPG/PNG): single Claude vision call */
export async function extractFromImage(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<ExtractionResult> {
  const raw = await callWithImage(FULL_PROMPT, imageBase64, mimeType)
  const result = parseJson<ExtractionResult>(raw)
  if (!result) throw new Error('Failed to parse extraction response')
  result.items = dedup(result.items ?? [])
  console.log(`[claude] image items: ${result.items.length}`)
  return result
}

/** Excel/text: send extracted CSV/text */
export async function extractFromText(text: string): Promise<ExtractionResult> {
  console.log(`[claude] text length: ${text.length}, first 300:\n${text.slice(0, 300)}`)
  // Split into 18K chunks if large
  const CHUNK = 18_000
  if (text.length <= CHUNK) {
    const raw = await callWithText(FULL_PROMPT, text)
    console.log(`[claude] text response (200): ${raw.slice(0, 200)}`)
    const result = parseJson<ExtractionResult>(raw)
    if (!result) throw new Error('Failed to parse extraction response')
    result.items = dedup(result.items ?? [])
    return result
  }

  const chunks = []
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK))

  const metaRaw = await callWithText(META_PROMPT, chunks[0])
  const meta = parseJson<Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'>>(metaRaw)
    ?? { supplier_name: 'Unknown Supplier', price_list_date: null, currency: null }

  const allItems: ExtractedItem[] = []
  for (let i = 0; i < chunks.length; i += 5) {
    const batch = chunks.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(async chunk => parseJson<ExtractedItem[]>(await callWithText(ITEMS_PROMPT, chunk)) ?? [])
    )
    results.forEach(items => allItems.push(...items))
  }

  return { ...meta, items: dedup(allItems) }
}

function dedup(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.name.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
