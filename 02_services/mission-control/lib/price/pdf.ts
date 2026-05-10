import { PDFDocument } from 'pdf-lib'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string; numpages: number }>

export async function getPageCount(buffer: Buffer): Promise<number> {
  try {
    const data = await pdfParse(buffer)
    return data.numpages
  } catch {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    return doc.getPageCount()
  }
}

/** Extract text from PDF. Returns empty string if PDF is image-only. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer)
    return data.text ?? ''
  } catch {
    return ''
  }
}

/** Split PDF into chunks of N pages, return as base64 strings */
export async function splitPdfIntoChunks(buffer: Buffer, pagesPerChunk: number): Promise<string[]> {
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true })
  const totalPages = srcDoc.getPageCount()
  const chunks: string[] = []

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages)
    const chunkDoc = await PDFDocument.create()
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i)
    const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices)
    copiedPages.forEach(p => chunkDoc.addPage(p))
    const bytes = await chunkDoc.save()
    chunks.push(Buffer.from(bytes).toString('base64'))
  }

  console.log(`[pdf] total pages: ${totalPages}, chunks: ${chunks.length} (${pagesPerChunk} pages each)`)
  return chunks
}
