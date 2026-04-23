// Import directly from lib to bypass pdf-parse test file loading (Next.js build issue)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer)
  return data.text
}
