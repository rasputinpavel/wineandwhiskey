import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { rowsToLineItems } from '@/lib/pricelist/import'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — a price list is a few hundred rows, not a data dump
const MAX_ROWS = 2000

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) return NextResponse.json({ error: 'no file' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 })
    const wb = XLSX.read(await file.arrayBuffer())
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return NextResponse.json({ error: 'empty workbook' }, { status: 400 })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `too many rows (max ${MAX_ROWS})` }, { status: 413 })
    return NextResponse.json(rowsToLineItems(rows))
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
