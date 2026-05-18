// Promo Pulse types. Mirror of supabase/migrations/014_promo_campaigns.sql.

export const PROMO_STATUSES = ['draft', 'generating', 'ready'] as const
export type PromoStatus = (typeof PROMO_STATUSES)[number]

export const PROMO_STATUS_LABEL: Record<PromoStatus, string> = {
  draft:      'Draft',
  generating: 'Generating…',
  ready:      'Ready',
}

// Four registers from design-system.md §7.
export const PROMO_MOODS = ['direct', 'casual', 'light', 'expert'] as const
export type PromoMood = (typeof PROMO_MOODS)[number]

export const PROMO_MOOD_LABEL: Record<PromoMood, string> = {
  direct:  'Direct — fact about wine, new arrival',
  casual:  'Casual — story, recommendation',
  light:   'Light — Friday, occasion, mood',
  expert:  'Expert — region, producer, vintage',
}

export const PROMO_VISUAL_MODES = ['dark', 'light'] as const
export type PromoVisualMode = (typeof PROMO_VISUAL_MODES)[number]

// Five composition templates from design-system.md §4.
export const PROMO_COMPOSITIONS = [
  'vitrina', 'zayavka', 'moment', 'kartochka', 'tsena',
] as const
export type PromoComposition = (typeof PROMO_COMPOSITIONS)[number]

export const PROMO_COMPOSITION_LABEL: Record<PromoComposition, string> = {
  vitrina:   'Витрина (product hero)',
  zayavka:   'Заявка (statement)',
  moment:    'Момент (action full-bleed)',
  kartochka: 'Карточка (info card)',
  tsena:     'Цена (price drop)',
}

// Asset keys filled by Phase 3. Each value is a path in Supabase Storage
// bucket `promo`, resolved to a signed URL by the API.
export type PromoAssets = Partial<{
  ig_post:            string
  ig_story:           string
  tg_post:            string
  poster_a2:          string
  stand_a3:           string
  web_banner_desktop: string
  web_banner_mobile:  string
  preview:            string
}>

export type PromoCampaign = {
  id:           string
  slug:         string
  theme:        string
  mechanic:     string
  starts_on:    string        // YYYY-MM-DD
  ends_on:      string        // YYYY-MM-DD
  mood:         PromoMood
  sku_slugs:    string[]
  status:       PromoStatus
  headline:     string | null
  subhead:      string | null
  caption_ig:   string | null
  caption_tg:   string | null
  visual_mode:  PromoVisualMode | null
  composition:  PromoComposition | null
  nbp_prompt:   string | null
  assets:       PromoAssets | null
  created_at:   string
  generated_at: string | null
  synced_at:    string | null
}

// Helper used by API + UI. Theme "Brunello Week" + 2026-05-19 → 'brunello-week_2026-05-19'.
export function slugify(theme: string, startsOn: string): string {
  const themeSlug = theme
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${themeSlug}_${startsOn}`
}
