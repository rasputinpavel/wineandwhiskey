import { GoogleGenAI } from '@google/genai'

// Nano Banana 2 — best quality among the API-accessible Gemini image models
// at the time of writing. Supports up to 4 character reference images for
// cross-scene consistency, which is exactly what we need.
const MODEL = 'gemini-3.1-flash-image-preview'

function getClient(): GoogleGenAI {
  const key = process.env.GOOGLE_API_KEY
  if (!key) throw new Error('GOOGLE_API_KEY not configured')
  return new GoogleGenAI({ apiKey: key })
}

export type ImageRef = {
  data: Buffer
  mimeType?: string  // defaults to image/jpeg
}

/**
 * Generate a single image with Nano Banana Pro.
 *
 * @param prompt        the natural-language description (image-prompt formula)
 * @param refImages     optional reference images (up to 4 for character
 *                      consistency, up to 10 for object fidelity)
 * @param aspectRatio   "9:16" for vertical reels (default), "16:9", "1:1", etc
 */
export async function generateImage(
  prompt: string,
  refImages: ImageRef[] = [],
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5' | '3:4' = '9:16',
): Promise<Buffer> {
  const ai = getClient()

  // Multipart contents: text first, then any reference images.
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]
  for (const ref of refImages) {
    parts.push({
      inlineData: {
        mimeType: ref.mimeType ?? 'image/jpeg',
        data: ref.data.toString('base64'),
      },
    })
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
    },
  })

  const out = response.candidates?.[0]?.content?.parts ?? []
  for (const p of out) {
    const inline = (p as { inlineData?: { data?: string } }).inlineData
    if (inline?.data) return Buffer.from(inline.data, 'base64')
  }
  throw new Error('Nano Banana returned no image data')
}
