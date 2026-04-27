import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, readdirSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const exec = promisify(execFile)

/**
 * Render all pages of a PDF to JPEG images using pdftoppm (poppler).
 * Returns array of base64-encoded JPEG strings, one per page.
 */
export async function renderPdfToImages(buffer: Buffer, scale = 150): Promise<string[]> {
  const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const pdfPath = join(tmpdir(), `${id}.pdf`)
  const outPrefix = join(tmpdir(), id)

  writeFileSync(pdfPath, buffer)

  try {
    await exec('pdftoppm', ['-jpeg', '-r', String(scale), pdfPath, outPrefix])
  } catch (err) {
    console.error('[pdf-render] pdftoppm failed:', err)
    cleanup(pdfPath, outPrefix)
    return []
  }

  // Collect output files: <prefix>-1.jpg, <prefix>-2.jpg, ...
  const dir = tmpdir()
  const files = readdirSync(dir)
    .filter(f => f.startsWith(id) && f.endsWith('.jpg'))
    .sort((a, b) => {
      const na = parseInt(a.replace(id + '-', '').replace('.jpg', ''))
      const nb = parseInt(b.replace(id + '-', '').replace('.jpg', ''))
      return na - nb
    })

  const images = files.map(f => readFileSync(join(dir, f)).toString('base64'))
  console.log(`[pdf-render] rendered ${images.length} pages`)

  cleanup(pdfPath, outPrefix, files.map(f => join(dir, f)))
  return images
}

function cleanup(pdfPath: string, outPrefix: string, imgPaths: string[] = []) {
  try { unlinkSync(pdfPath) } catch { /* ok */ }
  imgPaths.forEach(p => { try { unlinkSync(p) } catch { /* ok */ } })
}

export async function isPdftoppmAvailable(): Promise<boolean> {
  try {
    await exec('pdftoppm', ['-v'])
    return true
  } catch {
    return false
  }
}
