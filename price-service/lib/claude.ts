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

const EXTRACTION_PROMPT = `You are a wine price list parser. Extract all wine and spirits items from this price list.

Return a valid JSON object with EXACTLY this structure — no markdown, no explanation, just JSON:
{
  "supplier_name": "supplier company name as shown in the document",
  "price_list_date": "YYYY-MM-DD" or null,
  "currency": "THB" or "USD" or other 3-letter code, or null,
  "items": [
    {
      "name": "full product name",
      "country": "country of origin or null",
      "region": "wine region or null",
      "grape_variety": "comma-separated grape varieties or null",
      "price": numeric price (number only, no symbols) or null,
      "year": vintage year as integer or null,
      "volume": "750ml" or "1L" etc or null,
      "description": "product description if present or null"
    }
  ]
}

Rules:
- Extract ALL items: wines, champagnes, spirits, etc.
- price must be a number (e.g. 890, 1250.50) or null
- year must be a 4-digit integer or null
- grape_variety: comma-separate blends (e.g. "Cabernet Sauvignon, Merlot")
- If multiple price columns (retail/wholesale), use the retail/selling price
- Return ONLY the JSON object — no other text`

export async function extractPriceList(pdfText: string): Promise<ExtractionResult> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `${EXTRACTION_PROMPT}\n\n<price_list>\n${pdfText}\n</price_list>`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(clean) as ExtractionResult
}
