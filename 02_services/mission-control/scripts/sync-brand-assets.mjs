#!/usr/bin/env node
// Mirror brand + creative assets from the monorepo into mission-control/public/.
// Runs as `prebuild` and `predev` so the portal can link to them as static files.
// Without this, /m/design-system and /m/creative-library have no files to serve.

import { cp, rm, mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serviceRoot = path.resolve(__dirname, '..')
const repoRoot    = path.resolve(serviceRoot, '../..')
const publicDir   = path.join(serviceRoot, 'public')
const libDir      = path.join(serviceRoot, 'lib')

// Names skipped everywhere — tooling artefacts, sub-package noise, scratch screenshots,
// and build sources that are inputs to the assets rather than assets themselves.
const SKIP_NAMES = [
  /^node_modules$/,
  /^\.DS_Store$/,
  /^screencapture-/,         // huge Lovable screenshots in 04_brand root
  /^package(-lock)?\.json$/, // sub-package metadata in business_cards/, social/petnat/
  /^_/,                      // _preview.html / _print_*.html intermediates in business_cards/
  /\.mjs$/,                  // build.mjs, generate_logos.mjs, export.mjs — local build scripts
  /^print$/,                 // business_cards/print/: pre-split single-card PDFs for the printer
  /^fonts$/,                 // logo/fonts/: source TTFs for generate_logos.mjs
]

// PDFs balloon the committed mirror; html + preview is enough for the library.
// Source PDFs stay in 05_creative/output/ locally.
const CREATIVE_SKIP_EXT = new Set(['.pdf'])

// Extra skips for 05_creative/social/ — campaign folders contain build sources
// (background JPGs at multi-MB each) and pre-rendered exports (post/, stories/)
// that duplicate the top-level slides. The portal only needs the slides HTML
// and slide_NN.png previews.
const SOCIAL_SKIP_NAMES = [
  /^post$/,
  /^stories$/,
  /^print$/,
  /^image-prompts\.md$/,
  /\.mjs$/,
  /^back\d+\.(jpg|jpeg|png)$/i,
]

const skipName = (p) => SKIP_NAMES.some(re => re.test(path.basename(p)))
const skipCreative = (p) => skipName(p) || CREATIVE_SKIP_EXT.has(path.extname(p).toLowerCase())
const skipSocial = (p) => skipCreative(p) || SOCIAL_SKIP_NAMES.some(re => re.test(path.basename(p)))

// Mirror full asset trees → public/ for serving as static files.
// 05_creative/social mirrors under public/creative/social/ so the Creative Library
// can group campaigns under a "Social" subfolder.
const dirTasks = [
  { src: path.join(repoRoot, '04_brand'),               dst: path.join(publicDir, 'brand'),           filter: skipName     },
  { src: path.join(repoRoot, '05_creative/output'),     dst: path.join(publicDir, 'creative'),        filter: skipCreative },
  { src: path.join(repoRoot, '05_creative/social'),     dst: path.join(publicDir, 'creative/social'), filter: skipSocial   },
  { src: path.join(repoRoot, '10_sales/sales_playbook'), dst: path.join(publicDir, 'sales-playbook'), filter: skipName     },
]

for (const { src, dst, filter } of dirTasks) {
  if (!existsSync(src)) {
    console.warn(`[sync-brand-assets] skip — source missing: ${src}`)
    continue
  }
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  await cp(src, dst, { recursive: true, filter: (p) => !filter(p) })
  console.log(`[sync-brand-assets] ${path.relative(repoRoot, src)} → ${path.relative(serviceRoot, dst)}`)
}

// Mirror critical single files → lib/ for static import from React server components.
// Committed mirror serves as fallback when parent dirs aren't reachable on the build host.
const fileTasks = [
  { src: path.join(repoRoot, '04_brand/design-tokens.json'), dst: path.join(libDir, 'brand-tokens.json') },
]

for (const { src, dst } of fileTasks) {
  if (!existsSync(src)) {
    console.warn(`[sync-brand-assets] skip — source missing: ${src} (using committed mirror at ${path.relative(serviceRoot, dst)})`)
    continue
  }
  await copyFile(src, dst)
  console.log(`[sync-brand-assets] ${path.relative(repoRoot, src)} → ${path.relative(serviceRoot, dst)}`)
}
