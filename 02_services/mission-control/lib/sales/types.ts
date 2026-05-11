import type { BusinessKind, District, MinStars } from './config'

export const LEAD_STAGES = [
  'lead', 'in_work', 'contacted', 'meeting_set',
  'meeting_done', 'negotiating', 'first_purchase', 'rejected',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  lead:           'Лиды',
  in_work:        'Взят в работу',
  contacted:      'Контакт',
  meeting_set:    'Встреча назнач.',
  meeting_done:   'Встреча проведена',
  negotiating:    'Переговоры',
  first_purchase: 'Первая закупка',
  rejected:       'Отказ',
}

// Stages where the 5-day-stale rule applies (turns the card red).
export const ACTIVE_PIPELINE_STAGES: LeadStage[] = [
  'in_work', 'contacted', 'meeting_set', 'meeting_done', 'negotiating',
]

export type ScrapeStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'aborted' | 'imported'

// What the UI submits — multi-select districts that the backend splits into
// one scrape_run row per district.
export type ScrapeFormPayload = {
  districts:        District[]
  business_kind:    BusinessKind
  search_terms:     string[]
  category_filter:  string[]
  min_stars:        MinStars
  min_reviews:      number
  price_levels:     string[]
  max_per_search:   number
}

// What we store per scrape_run row — one district, one Apify run.
export type ScrapeInput = {
  district:         District | string | null
  business_kind:    BusinessKind
  search_terms:     string[]
  category_filter:  string[]
  min_stars:        MinStars
  min_reviews:      number
  price_levels:     string[]
  max_per_search:   number
}

export type ScrapeRun = {
  id:                string
  apify_run_id:      string | null
  apify_dataset_id:  string | null
  input:             ScrapeInput
  status:            ScrapeStatus
  scraped_count:     number
  imported_count:    number
  duplicate_count:   number
  rejected_count:    number
  error:             string | null
  created_at:        string
  finished_at:       string | null
}

export type Lead = {
  id:                string
  google_place_id:   string | null
  name:              string
  business_kind:     BusinessKind
  google_categories: string[] | null
  address:           string | null
  district:          string | null
  lat:               number | null
  lng:               number | null
  phone:             string | null
  website:           string | null
  rating:            number | null
  reviews_count:     number | null
  price_level:       string | null
  opening_hours:     unknown | null
  menu_url:          string | null
  image_url:         string | null
  raw:               unknown | null
  stage:             LeadStage
  assignee:          string | null
  first_taken_at:    string | null
  last_contact_at:   string | null
  next_action_at:    string | null
  notes:             string | null
  customer_id:       string | null
  source_run_id:     string | null
  created_at:        string
  updated_at:        string
}

export type LeadActivity = {
  id:       string
  lead_id:  string
  kind:     'call' | 'meeting' | 'whatsapp' | 'email' | 'note' | 'stage_change' | 'import'
  note:     string | null
  meta:     unknown | null
  at:       string
}

// Shape of items returned by compass/crawler-google-places. We only declare the
// fields we actually consume; everything else lives in `raw`.
export type ApifyPlaceItem = {
  placeId?:      string
  title?:        string
  categoryName?: string
  categories?:   string[]
  address?:      string
  neighborhood?: string
  city?:         string
  street?:       string
  postalCode?:   string
  state?:        string
  countryCode?:  string
  location?:     { lat: number; lng: number }
  phone?:        string
  phoneUnformatted?: string
  website?:      string
  url?:          string
  totalScore?:   number
  reviewsCount?: number
  price?:        string                 // "$", "$$", "$$$" or "$10–20" etc
  openingHours?: Array<{ day: string; hours: string }>
  menu?:         string | { link?: string }
  imageUrl?:     string
  imageUrls?:    string[]
  temporarilyClosed?: boolean
  permanentlyClosed?: boolean
}

export function staleDays(lead: Lead, now = new Date()): number | null {
  if (!ACTIVE_PIPELINE_STAGES.includes(lead.stage)) return null
  const since = lead.last_contact_at ?? lead.first_taken_at ?? lead.created_at
  if (!since) return null
  const ms = now.getTime() - new Date(since).getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

export function isStale(lead: Lead, days = 5, now = new Date()): boolean {
  const d = staleDays(lead, now)
  return d !== null && d > days
}
