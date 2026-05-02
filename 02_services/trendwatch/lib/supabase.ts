import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(url, key)

export type TrendAccount = {
  id: string
  username: string
  display_name: string | null
  followers_count: number | null
  avg_reel_views: number | null
  relevance_score: number | null
  category: string | null
  is_active: boolean
  last_reel_at: string | null
  added_at: string
}

export type ReelStatus = 'new' | 'analyzing' | 'analyzed' | 'approved' | 'skipped' | 'briefed' | 'published'

export type TrendReel = {
  id: string
  account_id: string | null
  instagram_id: string
  url: string | null
  views_count: number
  likes_count: number | null
  comments_count: number | null
  caption: string | null
  hashtags: string[] | null
  thumbnail_url: string | null
  video_url: string | null
  duration_s: number | null
  published_at: string | null
  discovered_at: string
  status: ReelStatus
  trend_accounts?: Pick<TrendAccount, 'username' | 'display_name'>
}

export type TrendFrame = {
  id: string
  reel_id: string
  timestamp_s: number
  storage_path: string
  created_at: string
}

export type ContentStructureItem = {
  second: number
  description: string
  type: 'hook' | 'content' | 'cta'
}

export type TrendAnalysis = {
  id: string
  reel_id: string
  hook_type: string | null
  hook_text: string | null
  hook_duration_s: number | null
  content_structure: ContentStructureItem[] | null
  format_type: string | null
  music_type: string | null
  text_overlays: string[] | null
  visual_elements: { lighting: string; setting: string; props: string } | null
  why_performs: string | null
  adaptation_score: number | null
  analyzed_at: string
}

export type VisualPrompt = {
  scene: string
  duration_s: number
  // New shape (runway-prompts methodology — image→video):
  shot?: string                  // e.g. "Medium · Over the shoulder · Push in"
  image_prompt?: string          // first-frame prompt
  motion_prompt?: string         // image-to-video prompt (motion only)
  input_image_source?: 'fresh' | 'last_frame_of_previous' | 'anchor_frame'
  // Legacy field (text-to-video). Still read by old briefs and as a fallback
  // when image_prompt / motion_prompt are missing.
  prompt_en?: string
}

export type ConsistencyAnchors = {
  subject:  string  // "Maria, 30s, red shoulder-length hair, navy linen apron…"
  location: string  // "interior of a Phuket boutique wine store, warm wood shelves…"
  lighting: string  // "warm golden side lighting, soft shadows, natural daylight"
  style:    string  // "cinematic, raw indie film aesthetic, 35mm film grain"
}

export type HookOption = {
  text: string
  style: string
}

export type OutlineStep = {
  step: number
  description: string
  duration_s: number
}

export type VideoStatus = 'idle' | 'generating' | 'assembling' | 'ready' | 'error'

export type TrendBrief = {
  id: string
  reel_id: string
  analysis_id: string | null
  hook_options: HookOption[] | null
  content_outline: OutlineStep[] | null
  music_direction: string | null
  text_overlay_copy: string[] | null
  visual_notes: string | null
  filming_instructions: string | null
  visual_prompts: VisualPrompt[] | null
  consistency_anchors: ConsistencyAnchors | null
  video_url: string | null
  video_status: VideoStatus
  created_at: string
}

export type TrendOurReel = {
  id: string
  brief_id: string | null
  reel_id: string | null
  instagram_url: string | null
  published_at: string | null
  views_7d: number | null
  views_14d: number | null
  views_30d: number | null
  likes_count: number | null
  followers_gained: number | null
  notes: string | null
  last_tracked_at: string | null
  created_at: string
}
