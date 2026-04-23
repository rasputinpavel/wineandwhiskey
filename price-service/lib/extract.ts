import { splitPdfIntoChunks } from './pdf'
import { extractFromChunks, extractFromImage, extractFromText } from './claude'
import type { ExtractionResult } from './claude'

export type FileType = 'pdf' | 'excel' | 'image'

export function detectFileType(filename: string, mimeType: string): FileType {
  const name = filename.toLowerCase()
  if (name.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (name.match(/\.(xls|xlsx)$/) || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel'
  return 'image'
}

export async function extractFromFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ExtractionResult> {
  const type = detectFileType(filename, mimeType)

  if (type === 'pdf') {
    const chunks = await splitPdfIntoChunks(buffer, 8)
    return extractFromChunks(chunks)
  }

  if (type === 'excel') {
    const text = extractExcelText(buffer, filename)
    return extractFromText(text)
  }

  // image
  const base64 = buffer.toString('base64')
  const safeMime = mimeType.startsWith('image/') ? mimeType as 'image/jpeg' | 'image/png' | 'image/webp' : 'image/jpeg'
  return extractFromImage(base64, safeMime)
}

function extractExcelText(buffer: Buffer, filename: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const header = `[File: ${filename}]\n`
  const sheets = workbook.SheetNames.map((name: string) => {
    const sheet = workbook.Sheets[name]
    return `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(sheet)}`
  }).join('\n\n')
  return header + sheets
}
