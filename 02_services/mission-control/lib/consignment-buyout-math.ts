// Pure buyout math — no I/O, unit-tested in consignment-buyout-math.test.ts.
//
// A buyout moves units out of the supplier's consignment pool onto our own
// books (see migration 042). From then on ONE physical SKU sits in two pools:
//
//   consignment — still the supplier's; selling a unit bills them
//   own         — already paid for on the buyout invoice; selling a unit bills
//                 nobody, it only turns our stock back into cash
//
// Owner's rule (5 Sep 2026): a sale draws from the OWN pool first. We already
// owe the money for those bottles, so moving them first is what keeps us from
// paying the supplier twice for the same case of wine.
//
// The pool is never stored — it is replayed from the buyout lots plus the sales
// that happened after them, so it self-corrects when a receipt is re-synced or
// a buyout line is edited.

export type BuyoutLot = {
  /** Bangkok-local instant the units became ours (start of `bought_at`). */
  atIso: string
  qty: number
}

export type SaleEvent = {
  /** Receipt timestamp (UTC ISO), compared lexicographically with lot instants. */
  atIso: string
  /** Units sold; negative for a REFUND. */
  qty: number
}

export type OwnedPoolResult = {
  /** Units still ours and unsold at the end of the window. */
  ownedRemaining: number
  /** Units sold INSIDE the window that came out of our pool → not billable. */
  ownedConsumedInWindow: number
  /** Units bought out INSIDE the window → they leave consignment closing stock. */
  boughtOutInWindow: number
}

/**
 * Replay buyout lots and sales in date order and report where the own pool
 * stands at `endExclIso`.
 *
 * A refund (negative qty) is credited back to the CONSIGNMENT pool, never to
 * ours: we cannot tell which pool the returned bottle came from, and guessing
 * "ours" would silently un-bill a unit the supplier was already paid for.
 */
export function runOwnedPool(
  lots: BuyoutLot[],
  sales: SaleEvent[],
  startIso: string,
  endExclIso: string,
): OwnedPoolResult {
  // Compare instants numerically, never as text: PostgREST hands back
  // "…+00:00" while our cycle bounds are "…Z", and the two do not sort
  // against each other reliably.
  const t = (iso: string) => Date.parse(iso)
  const start = t(startIso), endExcl = t(endExclIso)

  type Ev = { at: number; kind: 'buy' | 'sale'; qty: number }
  const events: Ev[] = [
    ...lots.map(l => ({ at: t(l.atIso), kind: 'buy' as const, qty: l.qty })),
    ...sales.map(s => ({ at: t(s.atIso), kind: 'sale' as const, qty: s.qty })),
  ].filter(e => Number.isFinite(e.at) && e.at < endExcl)
  // A buyout dated the same day as a sale takes effect first (start of day),
  // so same-day sales draw from the pool we just paid for.
  events.sort((a, b) => a.at - b.at || (a.kind === 'buy' ? -1 : 1))

  let owned = 0
  let ownedConsumedInWindow = 0
  let boughtOutInWindow = 0

  for (const e of events) {
    const inWindow = e.at >= start
    if (e.kind === 'buy') {
      owned += e.qty
      if (inWindow) boughtOutInWindow += e.qty
      continue
    }
    if (e.qty <= 0) continue                  // refund → consignment pool, not ours
    const fromOwn = Math.min(e.qty, owned)
    owned -= fromOwn
    if (inWindow) ownedConsumedInWindow += fromOwn
  }

  return { ownedRemaining: owned, ownedConsumedInWindow, boughtOutInWindow }
}

export type OwnedPlacement = {
  /** Invoiced to a B2B client, not paid yet — gone from the shelf, still in ON HAND. */
  inTransit: number
  /** Standing at a partner on our own consignment (delivery note). */
  atPartners: number
  /** Still on our shelf. */
  inStore: number
}

/**
 * Split the remaining own units across where the stock physically sits.
 *
 * Loyverse ON HAND mixes both pools, so the split is a convention, not a fact.
 * We place our own units into the "already gone" buckets first — invoiced-unpaid,
 * then out at a partner — because that is *why* a buyout happens: the bottles
 * left the shop, so the supplier wanted paying. It gives the honest reading of
 * "how much of what we paid for is still sitting here".
 */
export function allocateOwnedPlacement(
  ownedRemaining: number,
  b2bInTransit: number,
  onConsignment: number,
): OwnedPlacement {
  const owned = Math.max(0, ownedRemaining)
  const inTransit = Math.min(owned, Math.max(0, b2bInTransit))
  const atPartners = Math.min(owned - inTransit, Math.max(0, onConsignment))
  return { inTransit, atPartners, inStore: owned - inTransit - atPartners }
}
