import Anthropic from '@anthropic-ai/sdk'
import type { TrendAnalysis, TrendBrief, VisualPrompt, HookOption, OutlineStep } from './supabase'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type AnalysisInput = {
  frames: Array<{ timestamp_s: number; base64: string }>
  caption: string | null
  views: number
  likes: number | null
  duration: number | null
}

type AnalysisOutput = Omit<TrendAnalysis, 'id' | 'reel_id' | 'analyzed_at'>

export async function analyzeReelFrames(input: AnalysisInput): Promise<AnalysisOutput> {
  const imageContent: Anthropic.ImageBlockParam[] = input.frames.map(f => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: f.base64,
    },
  }))

  const frameLabels = input.frames.map(f => `Frame at ${f.timestamp_s}s`).join(', ')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `You are analyzing an Instagram Reel from a wine/spirits store competitor.
Frames provided: ${frameLabels}
Caption: ${input.caption ?? '(none)'}
Views: ${input.views.toLocaleString()} | Likes: ${input.likes ?? 'unknown'}
Duration: ${input.duration ?? 'unknown'}s

Analyze these frames and return a JSON object with exactly these fields:
{
  "hook_type": one of: "question"|"shock"|"before_after"|"product_reveal"|"pov"|"listicle"|"other",
  "hook_text": text visible or spoken in first 3 seconds (or null),
  "hook_duration_s": estimated hook duration in seconds,
  "content_structure": [{"second": 0, "description": "...", "type": "hook"|"content"|"cta"}],
  "format_type": one of: "talking_head"|"product_showcase"|"pov"|"text_driven"|"broll"|"mixed",
  "music_type": one of: "trending"|"original_voice"|"no_sound"|"ambient"|"unknown",
  "text_overlays": ["array of text strings visible in video"],
  "visual_elements": {"lighting": "...", "setting": "...", "props": "..."},
  "why_performs": "2-3 sentence hypothesis on why this gets high reach",
  "adaptation_score": integer 1-10 (how applicable is this format for a wine store in Phuket)
}
Return ONLY valid JSON, no markdown, no explanation.`,
          },
        ],
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  return JSON.parse(cleaned) as AnalysisOutput
}

type BriefInput = {
  analysis: AnalysisOutput
  caption: string | null
  views: number
  accountUsername: string
}

type BriefOutput = Omit<TrendBrief, 'id' | 'reel_id' | 'analysis_id' | 'video_url' | 'video_status' | 'created_at'>

export async function generateBrief(input: BriefInput): Promise<BriefOutput> {
  const isTalkingHead = input.analysis.format_type === 'talking_head'

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a content strategist for Wine & Whiskey, a wine and spirits retail store in Phuket, Thailand.
Brand: premium but approachable, curated selection, events-focused. Audience: expats and tourists.

Source Reel from @${input.accountUsername}: ${input.views.toLocaleString()} views
Caption: ${input.caption ?? '(none)'}

Analysis:
- Hook type: ${input.analysis.hook_type}
- Hook: "${input.analysis.hook_text ?? ''}"
- Format: ${input.analysis.format_type}
- Structure: ${JSON.stringify(input.analysis.content_structure)}
- Music: ${input.analysis.music_type}
- Text overlays: ${JSON.stringify(input.analysis.text_overlays)}
- Why it works: ${input.analysis.why_performs}

Generate an adaptation brief in JSON format:
{
  "hook_options": [
    {"text": "Hook variant 1 in English", "style": "direct/question/shock/reveal"},
    {"text": "Hook variant 2 in English", "style": "..."},
    {"text": "Hook variant 3 in English", "style": "..."}
  ],
  "content_outline": [
    {"step": 1, "description": "What to show/say", "duration_s": 3},
    ...
  ],
  "music_direction": "Specific music style/vibe recommendation",
  "text_overlay_copy": ["Line 1", "Line 2", "..."],
  "visual_notes": "Lighting, props, setting advice using our store",
  ${isTalkingHead
    ? '"filming_instructions": "Step-by-step camera/script instructions for filming this format",'
    : '"visual_prompts": [{"scene": "Scene name", "prompt_en": "Cinematic English prompt for Runway Gen-3", "duration_s": 5}, ...],'
  }
}
${isTalkingHead ? 'Since format is talking_head, set visual_prompts to null.' : 'Since format is not talking_head, set filming_instructions to null.'}
Return ONLY valid JSON.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned) as {
    hook_options: HookOption[]
    content_outline: OutlineStep[]
    music_direction: string
    text_overlay_copy: string[]
    visual_notes: string
    filming_instructions?: string
    visual_prompts?: VisualPrompt[]
  }

  return {
    hook_options: parsed.hook_options,
    content_outline: parsed.content_outline,
    music_direction: parsed.music_direction,
    text_overlay_copy: parsed.text_overlay_copy,
    visual_notes: parsed.visual_notes,
    filming_instructions: parsed.filming_instructions ?? null,
    visual_prompts: parsed.visual_prompts ?? null,
  }
}

type RelevanceInput = {
  username: string
  followersCount: number
  recentReelViews: number[]
  sampleCaptions: string[]
}

export async function scoreAccountRelevance(input: RelevanceInput): Promise<number> {
  const avgViews = input.recentReelViews.length
    ? Math.round(input.recentReelViews.reduce((a, b) => a + b, 0) / input.recentReelViews.length)
    : 0

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 50,
    messages: [
      {
        role: 'user',
        content: `Rate this Instagram account for relevance as a wine/spirits content source (1-10).

Account: @${input.username}
Followers: ${input.followersCount.toLocaleString()}
Avg Reel views: ${avgViews.toLocaleString()}
Sample captions: ${input.sampleCaptions.slice(0, 3).join(' | ')}

Criteria: wine/spirits focused content, posts Reels regularly, good engagement ratio.
Reply with ONLY a single integer 1-10.`,
      },
    ],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '5'
  const score = parseInt(text)
  return isNaN(score) ? 5 : Math.max(1, Math.min(10, score))
}
