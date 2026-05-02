import RunwayML from '@runwayml/sdk'
import type { VisualPrompt, ConsistencyAnchors } from './supabase'
import { execSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { supabase } from './supabase'
import { generateImage } from './nbp'
import { extractLastFrame } from './ffmpeg'

const BUCKET = 'trend-frames'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function getClient(): RunwayML {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new Error('RUNWAY_API_KEY not configured')
  return new RunwayML({ apiKey: key })
}

// ─── Anchor image generation (Nano Banana Pro) ───────────────────────────────

// Compose a final image prompt: scene-specific text + a footer that pins the
// four anchor strings verbatim. Keeps the consistency contract from the
// runway-prompts methodology — same byte-for-byte description in every scene.
function composeImagePrompt(prompt: VisualPrompt, anchors: ConsistencyAnchors | null): string {
  const base = prompt.image_prompt ?? prompt.prompt_en ?? prompt.scene
  if (!anchors) return base
  return [
    base,
    '',
    'Consistency anchors (do not deviate):',
    `Subject: ${anchors.subject}`,
    `Location: ${anchors.location}`,
    `Lighting: ${anchors.lighting}`,
    `Style: ${anchors.style}`,
  ].join('\n')
}

async function uploadImage(briefId: string, sceneIdx: number, image: Buffer): Promise<string> {
  const storagePath = `anchor_images/${briefId}/scene_${sceneIdx}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, image, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Anchor image upload failed: ${error.message}`)

  // Runway needs a fetchable URL. Bucket is private → signed URL is fine,
  // Runway downloads the bytes immediately as part of the task creation.
  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600)
  if (signErr || !data) throw new Error(`signed url failed: ${signErr?.message}`)
  return data.signedUrl
}

// ─── Image-to-video clip generation ──────────────────────────────────────────

async function generateClip(
  client: RunwayML,
  promptImage: string,
  motionPrompt: string,
  durationS: number,
): Promise<string> {
  const task = await client.imageToVideo.create({
    model: 'gen4_turbo',
    promptImage,
    promptText: motionPrompt,
    ratio: '720:1280',
    duration: Math.min(10, Math.max(2, Math.round(durationS))) as 5 | 10,
  })

  let result = await client.tasks.retrieve(task.id)
  const deadline = Date.now() + 5 * 60_000

  while (result.status !== 'SUCCEEDED' && Date.now() < deadline) {
    await sleep(8_000)
    result = await client.tasks.retrieve(task.id)
    if (result.status === 'FAILED') {
      const reason = (result as { failure?: string }).failure ?? task.id
      throw new Error(`Runway task failed: ${reason}`)
    }
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

// ─── Main pipeline: NBP image → Runway image-to-video → concat → overlay ───

export async function generateVideo(
  briefId: string,
  prompts: VisualPrompt[],
  textOverlays: string[],
  anchors: ConsistencyAnchors | null = null,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const runway = getClient()
  const tmpDir = `/tmp/tw_video_${briefId}`
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  const clipPaths: string[] = []
  let lastFramePath: string | null = null
  let scene1ImagePath: string | null = null  // reused as character ref for fresh scenes

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]
    const clipPath = path.join(tmpDir, `clip_${i}.mp4`)

    // Decide where the input image comes from.
    let imageBuffer: Buffer
    const wantsLastFrame = i > 0 && (prompt.input_image_source ?? 'last_frame_of_previous') === 'last_frame_of_previous' && lastFramePath
    if (wantsLastFrame && lastFramePath) {
      imageBuffer = readFileSync(lastFramePath)
    } else {
      // Fresh NBP generation. For scenes ≥ 2 with input_image_source='fresh',
      // pass scene-1 image as a character reference for consistency.
      const refs = scene1ImagePath && i > 0
        ? [{ data: readFileSync(scene1ImagePath), mimeType: 'image/jpeg' }]
        : []
      const promptText = composeImagePrompt(prompt, anchors)
      imageBuffer = await generateImage(promptText, refs, '9:16')

      // Cache scene-1 anchor for use as a reference in later "fresh" scenes.
      if (i === 0) {
        scene1ImagePath = path.join(tmpDir, `anchor_scene_0.jpg`)
        writeFileSync(scene1ImagePath, imageBuffer)
      }
    }

    // Upload to Storage so Runway can fetch it as promptImage.
    const promptImage = await uploadImage(briefId, i, imageBuffer)

    // Runway image-to-video. Motion prompt only — image carries identity.
    const motion = prompt.motion_prompt ?? prompt.image_prompt ?? prompt.prompt_en ?? ''
    if (!motion) throw new Error(`Scene "${prompt.scene}" has no motion prompt`)
    const videoUrl = await generateClip(runway, promptImage, motion, prompt.duration_s)
    await downloadClip(videoUrl, clipPath)
    clipPaths.push(clipPath)

    // Extract last frame for chaining into the next scene.
    lastFramePath = path.join(tmpDir, `last_frame_${i}.jpg`)
    extractLastFrame(clipPath, lastFramePath)

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

  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 7 * 24 * 3600)
  if (signErr || !data) throw new Error(`signed url failed: ${signErr?.message}`)

  // cleanup
  try {
    for (const p of [...clipPaths, assembledPath, finalPath]) unlinkSync(p)
    if (lastFramePath) unlinkSync(lastFramePath)
    if (scene1ImagePath) unlinkSync(scene1ImagePath)
    spawnSync('rmdir', [tmpDir])
  } catch { /* ignore cleanup errors */ }

  return data.signedUrl
}
