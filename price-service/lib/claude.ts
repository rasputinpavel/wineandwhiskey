import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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

const CHUNK_SIZE = 80_000 // chars per chunk — keeps output well within 8192 tokens

const META_PROMPT = `From this price list text, extract ONLY the supplier name and date.
Return ONLY this JSON, no other text:
{"supplier_name":"...","price_list_date":"YYYY-MM-DD or null","currency":"THB/USD/etc or null"}`

const ITEMS_PROMPT = `Extract ALL wine and spirits items from this price list text.
Return ONLY a JSON array, no other text:
[
  {
    "name":"full product name",
    "country":"country or null",
    "region":"region or null",
    "grape_variety":"comma-separated varieties or null",
    "price": number or null,
    "year": integer or null,
    "volume":"750ml etc or null",
    "description":"description or null"
  }
]
Rules: price = number only (no symbols). year = 4-digit integer. Return [] if no items found.`

async function callClaude(prompt: string, text: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n<text>\n${text}\n</text>`,
      },
    ],
  })
  const raw = response.content[0].type === 'text' ? response.content[0].text : ''
  return raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE))
  }
  return chunks.length ? chunks : ['']
}

export async function extractPriceList(pdfText: string): Promise<ExtractionResult> {
  const chunks = chunkText(pdfText)

  // Extract metadata from the first chunk
  const metaJson = await callClaude(META_PROMPT, chunks[0])
  const meta = JSON.parse(metaJson) as Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'>

  // Extract items from each chunk in parallel (max 5 concurrent)
  const allItems: ExtractedItem[] = []

  for (let i = 0; i < chunks.length; i += 5) {
    const batch = chunks.slice(i, i + 5)
    const results = await Promise.all(
      batch.map(chunk => callClaude(ITEMS_PROMPT, chunk).then(json => {
        try { return JSON.parse(json) as ExtractedItem[] }
        catch { return [] }
      }))
    )
    results.forEach(items => allItems.push(...items))
  }

  // Deduplicate by name (same product may appear in overlapping chunks)
  const seen = new Set<string>()
  const uniqueItems = allItems.filter(item => {
    const key = item.name.toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    supplier_name: meta.supplier_name || 'Unknown Supplier',
    price_list_date: meta.price_list_date ?? null,
    currency: meta.currency ?? null,
    items: uniqueItems,
  }
}
