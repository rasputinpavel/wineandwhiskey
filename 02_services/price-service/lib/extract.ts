import { splitPdfIntoChunks, extractPdfText } from './pdf'
import { extractFromChunks, extractFromImage, extractFromText, extractFromImageBatch } from './claude'
import type { ExtractionResult, ExtractedItem } from './claude'
import { renderPdfToImages, isPdftoppmAvailable } from './pdf-render'
import { isBBB, parseBBB } from './parsers/bbb'
import { isMagMag, parseMagMag } from './parsers/magmag'
import { isItalasia, parseItalasia } from './parsers/italasia'
import { isIWS, parseIWS } from './parsers/iws'
import { isJanhom, parseJanhom } from './parsers/janhom'
import { isPhop, parsePhop } from './parsers/phop'

export type FileType = 'pdf' | 'excel' | 'image'

// Maps Excel sheet names to country names
const SHEET_COUNTRY: Record<string, string | null> = {
  us: 'USA', ar: 'Argentina', au: 'Australia', ch: 'Chile',
  'f-alsace': 'France', 'f-bor': 'France', 'f-bur': 'France',
  'f-lang+loire+provence': 'France', 'f-rhone': 'France',
  gm: 'Germany', 'i-piedmont': 'Italy', 'i-friuli+ven+lom+trentino': 'Italy',
  'i-tuscany': 'Italy', 'i-abruzzo+campania+puglia': 'Italy', 'i-sicily': 'Italy',
  nz: 'New Zealand', sa: 'South Africa', sp: 'Spain',
  rose: null, sweet: null, sparkling: null, champ: 'France',
  'lr-non-750': null, ttg: null, 'ttg-non-750': null,
}

// Maps sheet names to regions
const SHEET_REGION: Record<string, string> = {
  'f-alsace': 'Alsace', 'f-bor': 'Bordeaux', 'f-bur': 'Burgundy',
  'f-lang+loire+provence': 'Languedoc / Loire / Provence', 'f-rhone': 'Rhône',
  'i-piedmont': 'Piedmont', 'i-friuli+ven+lom+trentino': 'Friuli / Veneto / Lombardy / Trentino',
  'i-tuscany': 'Tuscany', 'i-abruzzo+campania+puglia': 'Abruzzo / Campania / Puglia', 'i-sicily': 'Sicily',
  champ: 'Champagne',
}

export function detectFileType(filename: string, mimeType: string): FileType {
  const name = filename.toLowerCase()
  if (name.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (name.match(/\.(xls|xlsx)$/) || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel'
  return 'image'
}

export type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

export async function extractFromFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  onProgress?: ProgressCb,
): Promise<ExtractionResult> {
  const type = detectFileType(filename, mimeType)
  const report = onProgress ?? (() => {})

  if (type === 'pdf') {
    // Supplier-specific parsers come first — they don't lose items to
    // generic LLM token limits or dedup-by-name collisions.
    if (await isBBB(buffer)) {
      console.log('[extract] using BB&B deterministic parser')
      await report(10, 'parsing')
      const r = await parseBBB(buffer)
      await report(95, 'inserting')
      return r
    }
    if (await isMagMag(buffer, filename)) {
      console.log('[extract] using MagMag parser (Claude with supplier-specific prompt)')
      return parseMagMag(buffer, filename, report)
    }
    if (await isItalasia(buffer, filename)) {
      console.log('[extract] using Italasia parser (Claude with supplier-specific prompt)')
      return parseItalasia(buffer, filename, report)
    }
    if (await isIWS(buffer, filename)) {
      console.log('[extract] using IWS deterministic parser')
      const r = await parseIWS(buffer, filename, report)
      await report(95, 'inserting')
      return r
    }
    if (await isJanhom(buffer, filename)) {
      console.log('[extract] using Janhom parser (Claude with supplier-specific prompts)')
      return parseJanhom(buffer, filename, report)
    }
    if (await isPhop(buffer, filename)) {
      console.log('[extract] using P-HOPS parser (Claude Vision per chunk)')
      return parsePhop(buffer, filename, report)
    }

    // Strategy 1: render pages to images via pdftoppm (best quality, requires poppler)
    if (await isPdftoppmAvailable()) {
      console.log('[extract] using pdftoppm renderer')
      const images = await renderPdfToImages(buffer, 150)
      if (images.length > 0) {
        return extractFromImageBatch(images)
      }
    }

    // Strategy 2: text extraction (works for PDFs with embedded selectable text)
    const pdfText = await extractPdfText(buffer)
    const meaningfulChars = pdfText.replace(/\s+/g, ' ').trim().length
    console.log(`[extract] pdf text chars: ${meaningfulChars}`)
    if (meaningfulChars > 300) {
      return extractFromText(pdfText)
    }

    // Strategy 3: visual PDF chunks (Claude Vision via pdf-lib page splitting)
    const totalMb = buffer.length / 1024 / 1024
    const pagesPerChunk = totalMb > 15 ? 2 : totalMb > 5 ? 4 : 8
    const chunks = await splitPdfIntoChunks(buffer, pagesPerChunk)
    return extractFromChunks(chunks)
  }

  if (type === 'excel') {
    return extractFromExcel(buffer, filename)
  }

  // image
  const base64 = buffer.toString('base64')
  const safeMime = mimeType.startsWith('image/') ? mimeType as 'image/jpeg' | 'image/png' | 'image/webp' : 'image/jpeg'
  return extractFromImage(base64, safeMime)
}

async function extractFromExcel(buffer: Buffer, filename: string): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  // Try structured parsing first (works for hierarchical wine price lists)
  const structured = parseStructuredExcel(workbook, XLSX)
  if (structured.items.length > 0) {
    console.log(`[extract] structured parse: ${structured.items.length} items`)
    const meta = extractExcelMeta(workbook, XLSX, filename)
    return { ...meta, items: structured.items }
  }

  // Fallback: send CSV text to Claude
  console.log(`[extract] falling back to Claude text extraction`)
  const text = buildExcelText(workbook, XLSX, filename)
  return extractFromText(text)
}

function parseStructuredExcel(workbook: any, XLSX: any): { items: ExtractedItem[] } {
  const items: ExtractedItem[] = []
  const seen = new Set<string>()

  const dataSheets: string[] = workbook.SheetNames.filter(
    (n: string) => !['cover', 'index'].includes(n.toLowerCase())
  )

  dataSheets.forEach((sheetName: string) => {
    const sheet = workbook.Sheets[sheetName]
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    const sheetCountry = SHEET_COUNTRY[sheetName] ?? null
    const sheetRegion = SHEET_REGION[sheetName] ?? null

    let currentCountry = sheetCountry
    let currentRegion = sheetRegion
    let currentWinery = ''
    let pendingGrape = ''

    rows.forEach((row: any[]) => {
      const a = String(row[0] ?? '').trim()
      const b = String(row[1] ?? '').trim()
      const c = String(row[2] ?? '').trim()
      const d = String(row[3] ?? '').trim()

      // Country header: empty A, empty B, non-empty C all-caps
      if (!a && !b && c && c === c.toUpperCase() && c.length > 1) {
        currentCountry = c
        return
      }

      // All-caps B with no price = region/winery context
      if (!a && b && b === b.toUpperCase() && !d) {
        currentRegion = sheetRegion ?? b
        currentWinery = b
        return
      }

      // Grape note row: B in parentheses
      if (!a && b.startsWith('(') && b.endsWith(')')) {
        pendingGrape = b.slice(1, -1)
        return
      }

      // Wine row: A is a 4-digit year
      if (/^(19|20)\d{2}$/.test(a) && b) {
        const grape = pendingGrape || null
        pendingGrape = ''

        // Skip unavailable items (price says "soon", "tba", "na" etc.)
        if (/soon|tba|n\/a|coming/i.test(d)) return

        const priceRaw = d.replace(/[\s,]/g, '')
        const price = priceRaw && /^\d+(\.\d+)?$/.test(priceRaw) ? parseFloat(priceRaw) : null

        const dedup = `${a}|${b.toLowerCase()}|${sheetName}`
        if (seen.has(dedup)) return
        seen.add(dedup)

        items.push({
          name: b,
          country: currentCountry,
          region: currentRegion !== currentWinery ? currentRegion : null,
          grape_variety: grape,
          price,
          year: parseInt(a),
          volume: '750ml',
          description: currentWinery && currentWinery !== b ? currentWinery : null,
          category: null,
          wine_type: null,
        })
      }
    })
  })

  return { items }
}

function buildExcelText(workbook: any, XLSX: any, filename: string): string {
  const header = `[File: ${filename}]\n`
  const sheets = workbook.SheetNames.filter((n: string) => !['cover', 'index'].includes(n.toLowerCase()))
    .map((name: string) => `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n')
  return header + sheets
}

function extractExcelMeta(
  workbook: any,
  XLSX: any,
  filename: string
): Pick<ExtractionResult, 'supplier_name' | 'price_list_date' | 'currency'> {
  // Supplier from filename: "Wine_Gallery_price.xlsx" → "Wine Gallery"
  const supplierRaw = filename.replace(/\.(xlsx?|csv)$/i, '').replace(/[_-]/g, ' ').replace(/\s+price.*$/i, '').trim()
  const supplier_name = supplierRaw || 'Unknown Supplier'

  // Date: scan first sheet rows for a date pattern like "20-Apr-26" or "20.04.2026"
  let price_list_date: string | null = null
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' })
  for (const row of rows.slice(0, 10)) {
    for (const cell of row) {
      const s = String(cell ?? '')
      const m = s.match(/(\d{1,2})[\-\/\.]([A-Za-z]{3,9})[\-\/\.](\d{2,4})/)
      if (m) {
        const months: Record<string, string> = {
          jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
          jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'
        }
        const mo = months[m[2].toLowerCase().slice(0,3)]
        const yr = m[3].length === 2 ? '20' + m[3] : m[3]
        if (mo) { price_list_date = `${yr}-${mo}-${m[1].padStart(2,'0')}`; break }
      }
    }
    if (price_list_date) break
  }

  return { supplier_name, price_list_date, currency: 'THB' }
}
