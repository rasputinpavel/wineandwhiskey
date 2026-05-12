import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { scanCreative, formatSize, type Project, type Category } from '@/lib/creative-scan'

export const dynamic = 'force-dynamic'

const CATEGORY_ORDER: Category[] = ['Print', 'Sales kit', 'Social', 'Report', 'Photos', 'Other']

export default async function CreativeLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>
}) {
  const item = findItem('creative-library')!
  const { cat } = await searchParams
  const projects = await scanCreative()

  const counts = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] ?? 0) + 1
    return acc
  }, {})
  const visible = cat && cat !== 'All' ? projects.filter(p => p.category === cat) : projects

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">

          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="overline text-graphite">Finished design archive</div>
              <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
                Creative Library
              </h1>
              <p className="text-sm text-graphite mt-1">
                {projects.length} projects · auto-scan of <code className="text-xs">05_creative/output/</code>
              </p>
            </div>
          </header>

          <nav className="flex flex-wrap gap-2 border-b border-pale-stone pb-3">
            <CategoryPill label="All" count={projects.length} active={!cat || cat === 'All'} href="?" />
            {CATEGORY_ORDER.filter(c => counts[c]).map(c => (
              <CategoryPill key={c} label={c} count={counts[c]} active={cat === c} href={`?cat=${encodeURIComponent(c)}`} />
            ))}
          </nav>

          {visible.length === 0 ? (
            <div className="text-center py-12 text-graphite text-sm">
              Nothing here yet — drop finished design into <code>05_creative/output/</code>.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visible.map(p => <ProjectCard key={p.slug} project={p} />)}
            </div>
          )}

          <ConventionNote />
        </div>
      </div>
    </>
  )
}

function CategoryPill({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <a
      href={href}
      className={
        active
          ? 'text-xs px-3 py-1.5 rounded-sm bg-deep-black text-warm-white'
          : 'text-xs px-3 py-1.5 rounded-sm bg-cream/40 border border-pale-stone text-graphite hover:border-wine-red hover:text-wine-red transition-colors'
      }
    >
      {label} <span className="opacity-60">· {count}</span>
    </a>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const opener = project.files.find(f => f.ext === 'html') ?? project.files.find(f => f.ext === 'pdf') ?? project.files[0]
  return (
    <div className="bg-warm-white border border-pale-stone rounded-md overflow-hidden shadow-card hover:shadow-card-hover transition-shadow">
      <a href={opener?.href ?? '#'} target="_blank" rel="noopener" className="block aspect-[4/3] bg-cream/40 flex items-center justify-center overflow-hidden">
        {project.previewHref ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.previewHref} alt={project.title} className="max-h-full max-w-full object-cover" />
        ) : (
          <div className="text-center p-4">
            <span className="font-display text-pale-stone text-4xl uppercase tracking-display">W&amp;W</span>
            <div className="text-[11px] text-graphite mt-2">no preview</div>
          </div>
        )}
      </a>
      <div className="p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-heading font-semibold text-deep-black text-sm leading-tight truncate" title={project.title}>
            {project.title}
          </h3>
          {project.date && <span className="text-[11px] text-graphite shrink-0">{project.date}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="overline text-[9px] text-wine-red">{project.category}</span>
          {project.isDirectory && <span className="text-[10px] text-graphite">· folder</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {project.files.map(f => (
            <a
              key={f.href}
              href={f.href}
              target={f.ext === 'html' || f.ext === 'pdf' ? '_blank' : undefined}
              rel="noopener"
              download={f.ext !== 'html' && f.ext !== 'pdf'}
              className="text-[11px] px-2 py-1 border border-pale-stone rounded-sm text-graphite hover:border-wine-red hover:text-wine-red transition-colors"
              title={formatSize(f.size)}
            >
              {f.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConventionNote() {
  return (
    <details className="border border-pale-stone rounded-md bg-cream/30 mt-6">
      <summary className="px-4 py-3 cursor-pointer text-sm font-heading font-semibold text-deep-black">
        How to save design so it shows up here
      </summary>
      <div className="px-4 pb-4 text-sm text-graphite space-y-2">
        <p>
          Drop files into <code>05_creative/output/</code>. Name them <code>&lt;topic&gt;_YYYY-MM-DD.&lt;ext&gt;</code>
          {' '}(or a folder with the same name for multi-file projects).
        </p>
        <p>
          For a card preview, add <code>&lt;topic&gt;_YYYY-MM-DD_preview.png</code>
          {' '}next to it (square or 4:3, 800–1200px). Without it the card shows the W&amp;W monogram.
        </p>
        <p>
          Category is auto-detected by name (sales-kit / price-tag / welcome-offer / dashboard / sales). If it lands in &laquo;Other&raquo;, rename the file or add a rule in <code>lib/creative-scan.ts</code>.
        </p>
        <p>
          The archive syncs into <code>public/creative/</code> on <code>npm run build</code> or <code>npm run dev</code>.
        </p>
      </div>
    </details>
  )
}
