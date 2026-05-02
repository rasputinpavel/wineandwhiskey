import RunwayML from '@runwayml/sdk'
import type { VisualPrompt } from './supabase'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { supabase } from './supabase'

const BUCKET = 'trend-frames'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function getClient(): RunwayML {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new Error('RUNWAY_API_KEY not configured')
  return new RunwayML({ apiKey: key })
}

export type VideoJobResult = {
  scene: string
  clipPath: string
  durationS: number
}

async function generateClip(
  client: RunwayML,
  prompt: VisualPrompt
): Promise<string> {
  const task = await client.textToVideo.create({
    model: 'gen4.5',
    promptText: prompt.prompt_en,
    ratio: '720:1280',
    duration: Math.min(10, Math.max(2, Math.round(prompt.duration_s))),
  })

  let result = await client.tasks.retrieve(task.id)
  const deadline = Date.now() + 5 * 60_000

  while (result.status !== 'SUCCEEDED' && Date.now() < deadline) {
    await sleep(8_000)
    result = await client.tasks.retrieve(task.id)
    if (result.status === 'FAILED') throw new Error(`Runway task failed: ${task.id}`)
  }

  if (result.status !== 'SUCCEEDED') throw new Error('Runway task timed out')

  const output = result.output as string[] | undefined
  const videoUrl = output?.[0]
  if (!videoUrl) throw new Error('No video URL in Runway output')

  return videoUrl
}

async function downloadClip(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Clip download failed: ${res.status}`)
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()))
}

function assembleClips(clipPaths: string[], outputPath: string): void {
  const listFile = outputPath + '.txt'
  writeFileSync(listFile, clipPaths.map(p => `file '${p}'`).join('\n'))
  execSync(`ffmpeg -f concat -safe 0 -i "${listFile}" -c copy -y "${outputPath}"`, { stdio: 'pipe' })
  unlinkSync(listFile)
}

function burnTextOverlays(inputPath: string, texts: string[], outputPath: string): void {
  if (!texts.length) {
    execSync(`cp "${inputPath}" "${outputPath}"`)
    return
  }

  const fontsize = 52
  const yPositions = [120, 200, 280]
  const drawFilters = texts.slice(0, 3).map((text, i) => {
    const escaped = text.replace(/'/g, "\\'").replace(/:/g, '\\:')
    const y = yPositions[i] ?? 280 + i * 80
    return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontsize}:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2`
  })

  execSync(
    `ffmpeg -i "${inputPath}" -vf "${drawFilters.join(',')}" -c:a copy -y "${outputPath}"`,
    { stdio: 'pipe' }
  )
}

export async function generateVideo(
  briefId: string,
  prompts: VisualPrompt[],
  textOverlays: string[],
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  const runway = getClient()
  const tmpDir = `/tmp/tw_video_${briefId}`
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const clipPaths: string[] = []

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]
    const clipPath = path.join(tmpDir, `clip_${i}.mp4`)

    const videoUrl = await generateClip(runway, prompt)
    await downloadClip(videoUrl, clipPath)
    clipPaths.push(clipPath)

    onProgress?.(i + 1, prompts.length)
  }

  const assembledPath = path.join(tmpDir, 'assembled.mp4')
  assembleClips(clipPaths, assembledPath)

  const finalPath = path.join(tmpDir, 'final.mp4')
  burnTextOverlays(assembledPath, textOverlays, finalPath)

  const videoBuffer = readFileSync(finalPath)
  const storagePath = `videos/${briefId}/reel.mp4`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, videoBuffer, { contentType: 'video/mp4', upsert: true })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  // Bucket is private — same as the frames path; signed URL with a long TTL so
  // the user can still download the assembled video days later. Keep at 7d.
  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 7 * 24 * 3600)
  if (signErr || !data) throw new Error(`signed url failed: ${signErr?.message}`)

  // cleanup
  try {
    for (const p of [...clipPaths, assembledPath, finalPath]) unlinkSync(p)
    spawnSync('rmdir', [tmpDir])
  } catch { /* ignore cleanup errors */ }

  return data.signedUrl
}
