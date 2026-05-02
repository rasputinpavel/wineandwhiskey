import Anthropic from '@anthropic-ai/sdk'
import type { TrendAnalysis, TrendBrief, VisualPrompt, HookOption, OutlineStep, ConsistencyAnchors } from './supabase'

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

  const runwayMethodology = `
## Runway Prompting Methodology (apply when generating visual_prompts)

We follow the official Runway Academy prompting guide. Two pillars per prompt:
visual identity and motion. Use the image→video workflow: every scene needs a
first-frame IMAGE prompt and a separate MOTION prompt. Motion prompts focus
almost exclusively on motion — Runway's official rule, because the input image
already carries identity.

**Formula for the image prompt**:
[Shot size + angle] of [subject doing action] in [environment]. [Lighting]. [Style].

**Formula for the motion prompt**:
[Subject action]. [Camera move]. [Optional 2nd beat or environmental motion].

**Consistency anchors** — produce FOUR strings, then COPY-PASTE them verbatim
into every scene's image prompt. Never paraphrase. Anchor drift kills
consistency more than anything else.
- subject: name + 1-line physical description (concrete: hair, age, clothes,
  accessories). If no human subject, describe the hero product.
- location: 1-line interior/exterior description, props included.
- lighting: from this list — "warm golden side lighting, soft shadows" /
  "cool overcast diffused light" / "harsh midday sun, hard shadows" /
  "low-key dramatic lighting, single source" / "natural daylight from a side
  window, soft shadows".
- style: from this list — "cinematic, raw indie film aesthetic, 35mm film
  grain" / "polished commercial look, glossy" / "handheld documentary film
  style, observational feel" / "low budget realism, unpolished, authentic".

**Vocabulary** — pull terms from these lists, exact words:
- Shot sizes: Macro · Extreme close up · Close up · Medium · Full · Wide ·
  Extreme wide · Establishing
- Angles: Aerial · High angle · Low angle · Bird's eye view · Worm's eye view ·
  Over the shoulder · POV
- Camera moves: Pan · Tilt up · Tilt down · Dolly · Static · Push in ·
  Pull back · Truck · Pedestal · Tracking · Orbit · Arc · Crane · Jib · Zoom ·
  Crash zoom · Whip pan · Handheld · Steadicam · Gimbal
- Composition: Leading lines · Frame within frame · Symmetrical · Negative space
- Focus: Deep focus · Soft focus · Rack focus · Shallow focus

**Chaining** — for each scene N ≥ 2, set input_image_source:
- "last_frame_of_previous" when subject + location are unchanged from N-1
  (the most consistent path — strongly prefer this).
- "fresh" when location or subject changes (then reuse anchor strings verbatim
  in the image_prompt — only the location string differs).
- "anchor_frame" only for scene 1 (or when explicitly returning to scene-1 setup).

**Hard rules — Runway explicitly warns against these**:
- No multi-paragraph prompts. Each prompt is 1–3 sentences.
- No negative phrasing ("no people", "not blurry"). State what you DO want.
- No abstract language ("beautiful landscape"). Be concrete ("mountains at
  sunset, snow on the peaks").
- Motion prompts must NOT restate the visual anchors — image carries them.
- Same anchor strings in every scene's image_prompt, byte-for-byte.
`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
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
${isTalkingHead ? '' : runwayMethodology}
Generate an adaptation brief in JSON format:
{
  "hook_options": [
    {"text": "Hook variant 1 in English", "style": "direct/question/shock/reveal"},
    {"text": "Hook variant 2 in English", "style": "..."},
    {"text": "Hook variant 3 in English", "style": "..."}
  ],
  "content_outline": [
    {"step": 1, "description": "What to show/say", "duration_s": 3}
  ],
  "music_direction": "Specific music style/vibe recommendation",
  "text_overlay_copy": ["Line 1", "Line 2"],
  "visual_notes": "Lighting, props, setting advice using our store",
  ${isTalkingHead
    ? '"filming_instructions": "Step-by-step camera/script instructions for filming this format",\n  "consistency_anchors": null,\n  "visual_prompts": null'
    : `"consistency_anchors": {
    "subject":  "name + concrete 1-line description",
    "location": "1-line interior/exterior description with props",
    "lighting": "one phrase from the lighting vocabulary",
    "style":    "one phrase from the style vocabulary"
  },
  "visual_prompts": [
    {
      "scene": "Scene name",
      "duration_s": 5,
      "shot": "<shot size> · <angle> · <camera move>",
      "image_prompt": "[Shot] of [subject doing action] in [location]. [Lighting]. [Style].",
      "motion_prompt": "[Subject action]. [Camera move]. [Optional 2nd beat].",
      "input_image_source": "anchor_frame | last_frame_of_previous | fresh"
    }
  ],
  "filming_instructions": null`
  }
}
${isTalkingHead
  ? 'Since format is talking_head, set visual_prompts and consistency_anchors to null.'
  : 'Since format is not talking_head, set filming_instructions to null. Visual prompts MUST follow the Runway methodology above — copy-paste anchor strings verbatim into every scene\'s image_prompt.'}
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
    filming_instructions?: string | null
    visual_prompts?: VisualPrompt[] | null
    consistency_anchors?: ConsistencyAnchors | null
  }

  return {
    hook_options: parsed.hook_options,
    content_outline: parsed.content_outline,
    music_direction: parsed.music_direction,
    text_overlay_copy: parsed.text_overlay_copy,
    visual_notes: parsed.visual_notes,
    filming_instructions: parsed.filming_instructions ?? null,
    visual_prompts: parsed.visual_prompts ?? null,
    consistency_anchors: parsed.consistency_anchors ?? null,
  }
}

// ─── Account analysis (v3) ────────────────────────────────────────────────────

export type AccountAnalysis = {
  business_model_fit:           'wine_shop' | 'wine_bar' | 'media' | 'creator' | 'other'
  content_format_strength:      number   // 1–5
  retail_idea_density:          number   // 1–5
  format_copyability:           number   // 1–5: can you replicate the mechanic?
  production_copyability:       number   // 1–5: 5=phone, 1=studio
  retail_copyability:           number   // 1–5: 5=perfect for wine shop
  red_flags:                    string[]
  why_matters:                  string
  verdict:                      'keep' | 'maybe' | 'reject'
}

type AnalyzeAccountInput = {
  username:        string
  followers:       number
  medianViews:     number
  top3Views:       number
  hitRate:         number     // 0–1
  medianRatio:     number     // medianViews / followers
  stabilityLabel:  'good' | 'watch' | 'low' | 'unknown'
  sourceClusters:  string[]
  bio:             string
  sampleCaptions:  string[]
}

export async function analyzeAccount(input: AnalyzeAccountInput): Promise<AccountAnalysis> {
  const prompt =
    `You are scoring Instagram accounts as content inspiration for Wine & Whiskey — ` +
    `a wine & spirits retail store in Phuket (casual luxury tone). ` +
    `Language and target market are NOT a factor — we adapt content into our own voice. ` +
    `Score based purely on content format strength, retail applicability, and reproducibility.\n\n` +
    `Account: @${input.username}\n` +
    `Followers: ${input.followers.toLocaleString()}\n` +
    `Median Reel views: ${input.medianViews.toLocaleString()}\n` +
    `Top-3 avg views: ${input.top3Views.toLocaleString()}\n` +
    `Views/followers (median): ${input.medianRatio.toFixed(1)}x\n` +
    `Hit rate (reels >50K views): ${(input.hitRate * 100).toFixed(0)}%\n` +
    `Virality stability: ${input.stabilityLabel} (top1/median ratio)\n` +
    `Found via clusters: ${input.sourceClusters.join(', ')}\n` +
    `Bio: ${input.bio || '(none)'}\n` +
    `Sample captions: ${input.sampleCaptions.slice(0, 3).join(' | ') || '(none)'}\n\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{"business_model_fit":"wine_shop|wine_bar|media|creator|other",` +
    `"content_format_strength":1-5,` +
    `"retail_idea_density":1-5,` +
    `"format_copyability":1-5,` +
    `"production_copyability":1-5,` +
    `"retail_copyability":1-5,` +
    `"red_flags":["..."],` +
    `"why_matters":"one specific sentence",` +
    `"verdict":"keep|maybe|reject"}\n\n` +
    `Copyability guide:\n` +
    `- format_copyability: can the reel mechanic be replicated without a team?\n` +
    `- production_copyability: 5=phone-shot, 1=needs studio/pro crew\n` +
    `- retail_copyability: 5=perfect for a wine shop, 1=only works for creator/media`

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim()) as AccountAnalysis
  } catch {
    return {
      business_model_fit:      'other',
      content_format_strength: 3,
      retail_idea_density:     3,
      format_copyability:      3,
      production_copyability:  3,
      retail_copyability:      3,
      red_flags:               [],
      why_matters:             '',
      verdict:                 'maybe',
    }
  }
}
