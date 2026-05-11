// Supplier-specific parser registry.
//
// Each parser owns one supplier and knows how to read their price list.
// To add a new supplier:
//   1. Create lib/parsers/<id>.ts with its own detect/parse logic.
//   2. Add one entry to PARSERS below.
//
// extract.ts iterates the candidates matching the file type and uses the
// first one whose `detect()` returns true. If none match, the generic
// fallback chain in extract.ts runs (pdftoppm → text → vision).

import type { ExtractionResult } from '../claude'

export type FileType = 'pdf' | 'excel' | 'image'
export type ProgressCb = (pct: number, phase?: string, itemCount?: number) => Promise<void> | void

import { isBBB, parseBBB } from './bbb'
import { isMagMag, parseMagMag } from './magmag'
import { isItalasia, parseItalasia } from './italasia'
import { isIWS, parseIWS } from './iws'
import { isJanhom, parseJanhom } from './janhom'
import { isPhop, parsePhop } from './phop'
import { isHarvest, parseHarvest } from './harvest'
import { isUniversal, parseUniversal } from './universal'
import { isVinumLector, parseVinumLector } from './vinum-lector'
import { isIdeal, parseIdeal } from './ideal'
import { isWineGarage, parseWineGarage } from './wine-garage'
import {
  isWineGallery, parseWineGallery,
  isWineGalleryOffer, parseWineGalleryOffer,
} from './wine-gallery'

export type Parser = {
  id: string
  fileTypes: FileType[]
  detect: (buf: Buffer, filename: string, mimeType: string) => Promise<boolean>
  run:    (buf: Buffer, filename: string, mimeType: string, onProgress: ProgressCb) => Promise<ExtractionResult>
}

// `wrap` reproduces the legacy behaviour for deterministic parsers that
// don't emit progress themselves: report 10% before parsing, 95% after.
function wrap(parse: () => Promise<ExtractionResult>, cb: ProgressCb) {
  return (async () => {
    await cb(10, 'parsing')
    const r = await parse()
    await cb(95, 'inserting')
    return r
  })()
}

export const PARSERS: Parser[] = [
  // ── PDF: deterministic ──────────────────────────────────────────────────
  {
    id: 'bbb',
    fileTypes: ['pdf'],
    detect: (buf) => isBBB(buf),
    run: (buf, _f, _m, cb) => wrap(() => parseBBB(buf), cb),
  },
  {
    id: 'iws',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isIWS(buf, fn),
    run: (buf, fn, _m, cb) => parseIWS(buf, fn, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },
  {
    id: 'vinum-lector',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isVinumLector(buf, fn),
    run: (buf, fn, _m, cb) => parseVinumLector(buf, fn, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },
  {
    id: 'ideal',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isIdeal(buf, fn),
    run: (buf, fn, _m, cb) => parseIdeal(buf, fn, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },

  // ── PDF: LLM-driven (parser owns its progress reporting) ────────────────
  {
    id: 'magmag',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isMagMag(buf, fn),
    run: (buf, fn, _m, cb) => parseMagMag(buf, fn, cb),
  },
  {
    id: 'italasia',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isItalasia(buf, fn),
    run: (buf, fn, _m, cb) => parseItalasia(buf, fn, cb),
  },
  {
    id: 'janhom',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isJanhom(buf, fn),
    run: (buf, fn, _m, cb) => parseJanhom(buf, fn, cb),
  },
  {
    id: 'phop',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isPhop(buf, fn),
    run: (buf, fn, _m, cb) => parsePhop(buf, fn, cb),
  },
  {
    id: 'harvest',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isHarvest(buf, fn),
    run: (buf, fn, _m, cb) => parseHarvest(buf, fn, cb),
  },
  {
    id: 'wine-garage',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isWineGarage(buf, fn),
    run: (buf, fn, _m, cb) => parseWineGarage(buf, fn, cb),
  },
  {
    id: 'universal',
    fileTypes: ['pdf'],
    detect: (buf, fn) => isUniversal(buf, fn),
    run: (buf, fn, _m, cb) => parseUniversal(buf, fn, cb),
  },

  // ── Excel ───────────────────────────────────────────────────────────────
  {
    id: 'wine-gallery',
    fileTypes: ['excel'],
    detect: async (buf, fn) => isWineGallery(buf, fn),
    run: (buf, fn, _m, cb) => parseWineGallery(buf, fn, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },

  // ── Image ───────────────────────────────────────────────────────────────
  {
    id: 'wine-gallery-offer',
    fileTypes: ['image'],
    detect: async (_buf, fn, mt) => isWineGalleryOffer(fn, mt),
    run: (buf, _f, mt, cb) => parseWineGalleryOffer(buf, mt, cb).then(async (r) => {
      await cb(95, 'inserting')
      return r
    }),
  },
]

export async function findMatchingParser(
  buf: Buffer,
  filename: string,
  mimeType: string,
  fileType: FileType,
): Promise<Parser | null> {
  for (const p of PARSERS) {
    if (!p.fileTypes.includes(fileType)) continue
    if (await p.detect(buf, filename, mimeType)) return p
  }
  return null
}
