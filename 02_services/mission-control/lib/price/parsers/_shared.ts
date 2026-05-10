// Helpers shared across supplier-specific parsers.
//
// Every PDF parser used to inline its own copies of these — same code, just
// re-pasted nine times. They live here now so adding a new supplier is a
// matter of writing the supplier-specific logic, not boilerplate.

import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PDFDocument } from 'pdf-lib'
import Anthropic from '@anthropic-ai/sdk'

export const exec = promisify(execFile)

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Temp PDF on disk ─────────────────────────────────────────────────────

export async function writeTemp(buf: Buffer, prefix: string): Promise<string> {
  const path = join(tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`)
  writeFileSync(path, buf)
  return path
}

export function safeUnlink(path: string) {
  try { unlinkSync(path) } catch { /* ok */ }
}

// ─── pdftotext (poppler) ──────────────────────────────────────────────────

// `toPage <= 0` means "until end of document" — useful for parsers that
// dump the whole text in one shot.
export async function pdftotextLayout(path: string, fromPage: number, toPage: number): Promise<string> {
  const args = ['-layout', '-f', String(fromPage)]
  if (toPage > 0) args.push('-l', String(toPage))
  args.push(path, '-')
  const { stdout } = await exec('pdftotext', args, { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

// ─── pdf-lib helpers ──────────────────────────────────────────────────────

export async function getPageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  return doc.getPageCount()
}

export async function extractPdfPages(buf: Buffer, from: number, to: number): Promise<Buffer> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const indices: number[] = []
  for (let i = from - 1; i < to; i++) indices.push(i)
  const pages = await out.copyPages(src, indices)
  pages.forEach(p => out.addPage(p))
  return Buffer.from(await out.save())
}

// ─── JSON parsing (strips ```json fences) ─────────────────────────────────

export function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()) as T
  } catch {
    return null
  }
}

// ─── Claude PDF document call ─────────────────────────────────────────────

export async function callWithPdf(
  prompt: string,
  pdfBase64: string,
  opts: { maxTokens?: number; model?: string } = {},
): Promise<string> {
  const doc = { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 } }
  const res = await anthropic.messages.create({
    model: opts.model ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 8192,
    messages: [{ role: 'user', content: [doc as unknown as Anthropic.TextBlockParam, { type: 'text', text: prompt }] }],
  })
  return res.content[0].type === 'text' ? res.content[0].text : ''
}

// ─── Generic dedup by stable key ──────────────────────────────────────────

export function dedupBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter(it => {
    const key = keyFn(it)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
