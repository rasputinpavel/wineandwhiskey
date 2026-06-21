import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

// Discover finished design artefacts in public/creative/ (mirror of 05_creative/output/).
// Files are grouped by "stem" — the name with its YYYY-MM-DD / YYYY-MM date token
// stripped. The date may sit at the front (`2026-06-17_topic`, current convention) or
// at the end (`topic_2026-06-17`, legacy). The same stem with multiple extensions
// (html/pdf/png) is one project.
// Directories are projects on their own — we recurse one level to surface previews.

export type Asset = { label: string; ext: string; href: string; size: number }

export type Project = {
  slug: string             // stem, e.g. "welcome-offer"
  title: string            // human title derived from stem
  date: string | null      // YYYY-MM-DD or YYYY-MM if found in filename / dir name
  previewHref: string | null
  files: Asset[]
  isDirectory: boolean
}

// Date token as a trailing suffix (legacy) …
const DATE_FULL_SUFFIX = /_(\d{4}-\d{2}-\d{2})(?:_to_\d{4}-\d{2}-\d{2})?$/
const DATE_YM_SUFFIX   = /_(\d{4}-\d{2})$/
// … or a leading prefix (current convention — newest sorts to top in the filesystem).
const DATE_FULL_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:_to_\d{4}-\d{2}-\d{2})?_/
const DATE_YM_PREFIX   = /^(\d{4}-\d{2})_/

const EXT_LABELS: Record<string, string> = {
  html: 'HTML', pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', webp: 'WEBP',
  csv: 'CSV', md: 'MD', json: 'JSON',
}

function humanize(stem: string): string {
  return stem
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

function stripDate(stem: string): { stem: string; date: string | null } {
  const fullS = stem.match(DATE_FULL_SUFFIX)
  if (fullS) return { stem: stem.slice(0, fullS.index), date: fullS[1] }
  const ymS = stem.match(DATE_YM_SUFFIX)
  if (ymS) return { stem: stem.slice(0, ymS.index), date: ymS[1] }
  const fullP = stem.match(DATE_FULL_PREFIX)
  if (fullP) return { stem: stem.slice(fullP[0].length), date: fullP[1] }
  const ymP = stem.match(DATE_YM_PREFIX)
  if (ymP) return { stem: stem.slice(ymP[0].length), date: ymP[1] }
  return { stem, date: null }
}

function basenameNoExt(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() }
}

export async function scanCreative(): Promise<Project[]> {
  const root = path.join(process.cwd(), 'public/creative')
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  // Group files by date-stripped stem.
  const fileGroups = new Map<string, { date: string | null; files: Asset[]; previewFile?: string }>()
  const dirProjects: Project[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const abs = path.join(root, entry.name)

    // `social/` is a mirror of 05_creative/social — each child dir is a Social campaign.
    if (entry.isDirectory() && entry.name === 'social') {
      const inner = await readdir(abs, { withFileTypes: true }).catch(() => [])
      for (const e of inner) {
        if (!e.isDirectory()) continue
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue
        const project = await projectFromDir(e.name, path.join(abs, e.name), {
          hrefPrefix: `/creative/social/${e.name}`,
        })
        if (project) dirProjects.push(project)
      }
      continue
    }

    // Bulk product-image dumps (`wines`/`wine` stem) belong on the Product Images page,
    // not the Creative Library — regardless of where the date token sits.
    const rawStem = entry.isDirectory() ? entry.name : basenameNoExt(entry.name).stem
    if (/^wines?$/i.test(stripDate(rawStem.replace(/_preview$/, '')).stem)) continue

    if (entry.isDirectory()) {
      const project = await projectFromDir(entry.name, abs)
      if (project) dirProjects.push(project)
      continue
    }

    const { stem, ext } = basenameNoExt(entry.name)
    if (!ext) continue

    // strip _preview suffix for grouping
    const previewBare = stem.replace(/_preview$/, '')
    const isPreview = stem !== previewBare
    const { stem: groupStem, date } = stripDate(previewBare)

    // group key includes date so projects of same stem but different dates stay separate
    const key = `${groupStem}__${date ?? ''}`
    const st = await stat(abs)
    const asset: Asset = {
      label: EXT_LABELS[ext] ?? ext.toUpperCase(),
      ext,
      href: `/creative/${entry.name}`,
      size: st.size,
    }

    if (!fileGroups.has(key)) fileGroups.set(key, { date, files: [] })
    const g = fileGroups.get(key)!
    if (isPreview && (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp')) {
      g.previewFile = `/creative/${entry.name}`
    } else {
      g.files.push(asset)
    }
  }

  const fileProjects: Project[] = []
  for (const [key, g] of fileGroups) {
    if (g.files.length === 0 && !g.previewFile) continue
    const [groupStem] = key.split('__')
    fileProjects.push({
      slug: `${groupStem}-${g.date ?? 'undated'}`,
      title: humanize(groupStem),
      date: g.date,
      previewHref: g.previewFile ?? null,
      files: g.files.sort((a, b) => orderExt(a.ext) - orderExt(b.ext)),
      isDirectory: false,
    })
  }

  return [...dirProjects, ...fileProjects].sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? 1 : -1
    if (a.date) return -1
    if (b.date) return 1
    return a.title.localeCompare(b.title)
  })
}

async function projectFromDir(
  name: string,
  abs: string,
  opts: { hrefPrefix?: string } = {},
): Promise<Project | null> {
  let inner: import('node:fs').Dirent[] = []
  try {
    inner = await readdir(abs, { withFileTypes: true })
  } catch {
    return null
  }

  const hrefPrefix = opts.hrefPrefix ?? `/creative/${name}`
  const files: Asset[] = []
  let previewHref: string | null = null
  for (const e of inner) {
    if (!e.isFile()) continue
    if (e.name.startsWith('.')) continue
    const { ext } = basenameNoExt(e.name)
    const href = `${hrefPrefix}/${e.name}`
    const st = await stat(path.join(abs, e.name))
    if (!previewHref && /preview\.(png|jpg|jpeg|webp)$/i.test(e.name)) {
      previewHref = href
      continue
    }
    files.push({ label: EXT_LABELS[ext] ?? ext.toUpperCase(), ext, href, size: st.size })
  }
  if (!previewHref) {
    const firstImg = files.find(f => ['png', 'jpg', 'jpeg', 'webp'].includes(f.ext))
    if (firstImg) previewHref = firstImg.href
  }

  const { stem, date } = stripDate(name)
  return {
    slug: `dir-${name}`,
    title: humanize(stem),
    date,
    previewHref,
    files: files.sort((a, b) => orderExt(a.ext) - orderExt(b.ext)),
    isDirectory: true,
  }
}

const EXT_ORDER = ['html', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'md', 'csv', 'json']
function orderExt(e: string) {
  const i = EXT_ORDER.indexOf(e)
  return i === -1 ? 99 : i
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
