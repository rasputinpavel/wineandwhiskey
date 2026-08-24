import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchWithRetry, expensesErrorHint, fetchExpenses } from './income'

const OK = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const FAIL = (status: number, message = 'The service is currently unavailable.') =>
  new Response(JSON.stringify({ error: { code: status, message, status: 'UNAVAILABLE' } }), { status })

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('fetchWithRetry', () => {
  it('retries a transient 503 and returns the eventual success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(FAIL(503))
      .mockResolvedValueOnce(FAIL(503))
      .mockResolvedValueOnce(OK({ values: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchWithRetry('https://x/', {}, 'test', { baseDelayMs: 0 })
    expect(r.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a network-level failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(OK({ values: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchWithRetry('https://x/', {}, 'test', { baseDelayMs: 0 })
    expect(r.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 403 — that is our problem, not Google’s', async () => {
    const fetchMock = vi.fn().mockResolvedValue(FAIL(403, 'Permission denied'))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchWithRetry('https://x/', {}, 'test', { baseDelayMs: 0 })
    expect(r.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt budget and surfaces the upstream status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(FAIL(503))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchWithRetry('https://x/', {}, 'test', { baseDelayMs: 0, attempts: 3 })
    expect(r.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('fetchExpenses', () => {
  const creds = () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'refresh')
  }

  it('survives a transient 503 on the sheet read', async () => {
    creds()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ access_token: 'tok' }))
      .mockResolvedValueOnce(FAIL(503))
      .mockResolvedValueOnce(OK({ values: [['24.08.2026', '฿8 060,31', 'Italasia', 'TRUE', 'FALSE', 'TRUE', 'Кредиторка', 'account']] }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchExpenses({ baseDelayMs: 0 })
    expect(out).toEqual([
      { date: '2026-08-24', amount: 8060.31, description: 'Italasia', wallet: 'account', category: 'Кредиторка' },
    ])
  })

  it('reports the upstream status plainly when Google stays down', async () => {
    creds()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK({ access_token: 'tok' }))
      .mockResolvedValue(FAIL(503)))

    await expect(fetchExpenses({ baseDelayMs: 0, attempts: 2 }))
      .rejects.toThrow(/Expenses read: 503/)
  })

  it('still names the missing credentials when they are not set', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    vi.stubEnv('GOOGLE_REFRESH_TOKEN', '')
    await expect(fetchExpenses({ baseDelayMs: 0 })).rejects.toThrow(/credentials missing/i)
  })
})

describe('expensesErrorHint', () => {
  it('points at the env vars only when credentials are the problem', () => {
    expect(expensesErrorHint('Google Sheets credentials missing — set GOOGLE_CLIENT_ID / ...'))
      .toMatch(/GOOGLE_CLIENT_ID/)
  })

  it('tells the reader to reload when Google is the problem', () => {
    const hint = expensesErrorHint('Expenses read: 503 The service is currently unavailable.')
    expect(hint).not.toMatch(/GOOGLE_CLIENT_ID/)
    expect(hint).toMatch(/reload|again/i)
  })
})
