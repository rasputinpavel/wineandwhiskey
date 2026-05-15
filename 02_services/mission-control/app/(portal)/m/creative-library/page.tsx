import { findItem } from '@/lib/registry'
import { PaneHeader } from '@/components/shell/PaneHeader'
import { scanCreative, formatSize, type Project } from '@/lib/creative-scan'

export const dynamic = 'force-dynamic'

export default async function CreativeLibraryPage() {
  const item = findItem('creative-library')!
  const projects = await scanCreative()

  return (
    <>
      <PaneHeader item={item} />
      <div className="flex-1 overflow-y-auto bg-warm-white">
        <div className="max-w-[960px] mx-auto px-6 py-6 space-y-5">

          <header>
            <div className="overline text-graphite">Finished design archive</div>
            <h1 className="font-display text-deep-black uppercase tracking-display" style={{ fontSize: 36, lineHeight: 1 }}>
              Creative Library
            </h1>
            <p className="text-sm text-graphite mt-1">
              {projects.length} projects · auto-scan of <code className="text-xs">05_creative/output/</code>
            </p>
          </header>

          {projects.length === 0 ? (
            <div className="text-center py-12 text-graphite text-sm">
              Nothing here yet — drop finished design into <code>05_creative/output/</code>.
            </div>
          ) : (
            <ul className="divide-y divide-pale-stone border-y border-pale-stone">
              {projects.map(p => <ProjectRow key={p.slug} project={p} />)}
            </ul>
          )}

          <ConventionNote />
        </div>
      </div>
    </>
  )
}

function ProjectRow({ project }: { project: Project }) {
  const opener = project.files.find(f => f.ext === 'html') ?? project.files.find(f => f.ext === 'pdf') ?? project.files[0]
  return (
    <li className="flex items-center gap-4 py-3 group">
      <a
        href={opener?.href ?? '#'}
        target="_blank"
        rel="noopener"
        className="shrink-0 w-20 h-16 bg-cream/40 border border-pale-stone rounded-sm overflow-hidden flex items-center justify-center"
      >
        {project.previewHref ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.previewHref} alt={project.title} className="w-full h-full object-cover" />
        ) : (
          <span className="font-display text-pale-stone text-lg uppercase tracking-display">W&amp;W</span>
        )}
      </a>
      <div className="flex-1 min-w-0">
        <a
          href={opener?.href ?? '#'}
          target="_blank"
          rel="noopener"
          className="font-heading font-semibold text-deep-black text-sm leading-tight hover:text-wine-red transition-colors"
        >
          {project.title}
        </a>
        <div className="flex items-center gap-2 text-[11px] text-graphite mt-0.5">
          {project.date && <span>{project.date}</span>}
          {project.isDirectory && <span>· folder</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 shrink-0">
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
    </li>
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
          For a row preview, add <code>&lt;topic&gt;_YYYY-MM-DD_preview.png</code>
          {' '}next to it (square or 4:3, 800–1200px). Without it the row shows the W&amp;W monogram.
        </p>
        <p>
          The archive syncs into <code>public/creative/</code> on <code>npm run build</code> or <code>npm run dev</code>.
        </p>
      </div>
    </details>
  )
}
