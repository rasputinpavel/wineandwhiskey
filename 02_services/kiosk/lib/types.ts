export type WineColor = 'red' | 'white' | 'rose' | 'sparkling' | 'orange'

export type WineCard = {
  id:            string         // sku_id (uuid)
  code:          string | null  // loyverse_product_code, used in URL
  name:          string
  color:         WineColor | null
  grape:         string | null
  country:       string | null
  winery:        string | null
  price_thb:     number | null
  qty:           number         // current on_hand
  image_url:     string | null  // Vivino image when available
  vivino_rating: number | null
  vivino_url:    string | null
  description:   string | null
  food_pairings: string[]
  body:          string | null  // 'light bodied' | 'medium bodied' | 'full bodied' | ...
}
