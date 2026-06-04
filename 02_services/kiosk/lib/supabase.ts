import { createClient } from '@supabase/supabase-js'

// Same Supabase project as mission-control + price-service.
// Kiosk only reads — never writes inventory or Vivino data.

const url = process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_KEY!

// Inventory schema — v_sku_breakdown view with on_hand stock.
export const sbInventory = createClient(url, key, { db: { schema: 'inventory' } })

// public schema — wine_items table holds Vivino enrichment, image, supplier name.
export const sbPublic = createClient(url, key)
