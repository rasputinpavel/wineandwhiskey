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

const META_PROMPT = `From this price list, extract ONLY the supplier/company name and date.
Return ONLY this JSON (no markdown, no other text):
{"supplier_name":"...","price_list_date":"YYYY-MM-DD or null","currency":"THB or USD or null"}`

const ITEMS_PROMPT = `Extract ALL wine and spirits items visible in this price list.
Return ONLY a compact JSON array (no markdown, no explanation):
[{"name":"...","country":"...or null","region":"...or null","grape_variety":"...or null","price":number or null,"year":integer or null,"volume":"...or null","description":"...or null"}]
If no items found, return [].`

type DocBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

async function callClaude(prompt: string, pdfBase64: string): Promise<string> {
  const doc: DocBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        doc as unknown as Anthropic.TextBlockParam,
        { type: 'text', text: prompt },
      ],
    }],
  })
  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  return raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
}

export async function extractFromChunks(pdfChunks: string[]): Promise<ExtractionResult> {
  // Extract metadata from the first chunk
  const metaJson = await callClaude(META_PROMPT, pdfChunks[0])
  let meta: Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'>
  try {
    meta = JSON.parse(metaJson)
  } catch {
    meta = { supplier_name: 'Unknown Supplier', price_list_date: null, currency: null }
  }

  // Extract items from all chunks (batches of 5 concurrent)
  const allItems: ExtractedItem[] = []

  for (let i = 0; i < pdfChunks.length; i += 5) {
    const batch = pdfChunks.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(async (chunk, batchIdx) => {
        const json = await callClaude(ITEMS_PROMPT, chunk)
        console.log(`[claude] chunk ${i + batchIdx + 1}/${pdfChunks.length} → ${json.slice(0, 80)}`)
        try {
          return JSON.parse(json) as ExtractedItem[]
        } catch {
          return []
        }
      })
    )
    results.forEach(items => allItems.push(...items))
  }

  // Deduplicate by name
  const seen = new Set<string>()
  const unique = allItems.filter(item => {
    const key = item.name.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`[claude] total items extracted: ${unique.length}`)
  return {
    supplier_name: meta.supplier_name || 'Unknown Supplier',
    price_list_date: meta.price_list_date ?? null,
    currency: meta.currency ?? null,
    items: unique,
  }
}
