// POST /api/m/reactivation/generate-message
//
// Body: { customerId: string }
// Loads the snapshot for that customer (same loader the page uses) and asks
// Claude Haiku to write a short, warm English reactivation message.

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { loadReactivationCustomers } from '@/lib/reactivation/data'
import { generateReactivationMessage } from '@/lib/reactivation/message'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { customerId?: string; windowDays?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const customerId = body.customerId
  if (!customerId) {
    return NextResponse.json({ error: 'customerId required' }, { status: 400 })
  }

  try {
    const customers = await loadReactivationCustomers({ windowDays: body.windowDays })
    const customer = customers.find(c => c.customerId === customerId)
    if (!customer) {
      return NextResponse.json({ error: 'customer not found in window' }, { status: 404 })
    }
    const message = await generateReactivationMessage(customer)
    return NextResponse.json({ message })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY missing or invalid — set it in Railway env vars' },
        { status: 500 },
      )
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limited by Anthropic — try again in a minute' },
        { status: 429 },
      )
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic ${e.status}: ${e.message}` },
        { status: 502 },
      )
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
