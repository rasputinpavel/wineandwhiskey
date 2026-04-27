import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync, rmdirSync } from 'fs'
import path from 'path'
import { supabase } from './supabase'

const BUCKET = 'trend-frames'

export type ExtractedFrame = {
  timestamp_s: number
  storage_path: string
}

function frameTimestamps(durationS: number): number[] {
  const hook = [0, 1, 2, 3].filter(t => t < durationS)
  const content = [
    Math.round(durationS * 0.3),
    Math.round(durationS * 0.5),
    Math.round(durationS * 0.7),
  ].filter(t => t > 3 && t < durationS - 2)
  const outro = durationS > 5 ? [Math.max(0, Math.round(durationS - 2))] : []
  return [...new Set([...hook, ...content, ...outro])].sort((a, b) => a - b)
}

async function downloadVideo(videoUrl: string, destPath: string): Promise<void> {
  const res = await fetch(videoUrl)
  if (!res.ok) throw new Error(`Video download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buf)
}

function extractFrame(videoPath: string, timestamp: number, framePath: string): void {
  execSync(
    `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 -y "${framePath}"`,
    { stdio: 'pipe' }
  )
}

function probeDuration(videoPath: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim()
    return parseFloat(out) || 30
  } catch {
    return 30
  }
}

export async function extractAndUploadFrames(
  reelId: string,
  videoUrl: string,
  knownDuration?: number
): Promise<ExtractedFrame[]> {
  const tmpDir = `/tmp/tw_${reelId}`
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const videoPath = path.join(tmpDir, 'video.mp4')

  try {
    await downloadVideo(videoUrl, videoPath)

    const duration = knownDuration || probeDuration(videoPath)
    const timestamps = frameTimestamps(duration)

    const frames: ExtractedFrame[] = []

    for (const ts of timestamps) {
      const frameName = `frame_${ts}s.jpg`
      const framePath = path.join(tmpDir, frameName)
      const storagePath = `${reelId}/${frameName}`

      extractFrame(videoPath, ts, framePath)

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, readFileSync(framePath), {
          contentType: 'image/jpeg',
          upsert: true,
        })

      if (error) {
        console.error(`[ffmpeg] upload failed for ${frameName}:`, error.message)
        continue
      }

      frames.push({ timestamp_s: ts, storage_path: storagePath })

      unlinkSync(framePath)
    }

    return frames
  } finally {
    try { unlinkSync(videoPath) } catch { /* already deleted */ }
    try { rmdirSync(tmpDir) } catch { /* dir not empty or already gone */ }
  }
}

export async function getFrameBase64(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) throw new Error(`Frame download failed: ${error?.message}`)
  const buf = Buffer.from(await data.arrayBuffer())
  return buf.toString('base64')
}

export async function getPublicFrameUrl(storagePath: string): Promise<string> {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
}
