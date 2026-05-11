#!/usr/bin/env node
// Mirror brand + creative assets from the monorepo into mission-control/public/.
// Runs as `prebuild` and `predev` so the portal can link to them as static files.
// Without this, /m/design-system and /m/creative-library have no files to serve.

import { cp, rm, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serviceRoot = path.resolve(__dirname, '..')
const repoRoot    = path.resolve(serviceRoot, '../..')
const publicDir   = path.join(serviceRoot, 'public')

const SKIP = [
  /^node_modules$/,
  /^\.DS_Store$/,
  /^screencapture-/,         // huge Lovable screenshots in 04_brand root
  /^package(-lock)?\.json$/, // sub-package metadata in business_cards/
]

const shouldSkip = (p) => SKIP.some(re => re.test(path.basename(p)))

const tasks = [
  { src: path.join(repoRoot, '04_brand'),         dst: path.join(publicDir, 'brand') },
  { src: path.join(repoRoot, '05_creative/output'), dst: path.join(publicDir, 'creative') },
]

for (const { src, dst } of tasks) {
  if (!existsSync(src)) {
    console.warn(`[sync-brand-assets] skip — source missing: ${src}`)
    continue
  }
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  await cp(src, dst, { recursive: true, filter: (p) => !shouldSkip(p) })
  console.log(`[sync-brand-assets] ${path.relative(repoRoot, src)} → ${path.relative(serviceRoot, dst)}`)
}
