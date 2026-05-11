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

const SKIP = [
  /^node_modules$/,
  /^\.DS_Store$/,
  /^screencapture-/,         // huge Lovable screenshots in 04_brand root
  /^package(-lock)?\.json$/, // sub-package metadata in business_cards/
]

const shouldSkip = (p) => SKIP.some(re => re.test(path.basename(p)))

// Mirror full asset trees → public/ for serving as static files.
const dirTasks = [
  { src: path.join(repoRoot, '04_brand'),           dst: path.join(publicDir, 'brand') },
  { src: path.join(repoRoot, '05_creative/output'), dst: path.join(publicDir, 'creative') },
]

for (const { src, dst } of dirTasks) {
  if (!existsSync(src)) {
    console.warn(`[sync-brand-assets] skip — source missing: ${src}`)
    continue
  }
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  await cp(src, dst, { recursive: true, filter: (p) => !shouldSkip(p) })
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
