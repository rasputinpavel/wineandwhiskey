// PATCH /api/m/users/[id] — update access / admin / disabled / password
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/portal/require-admin'
import { updateUser, getGuardUsers, type UpdateInput } from '@/lib/portal/users-store'
import { checkSelfLockout } from '@/lib/portal/guards'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const input: UpdateInput = {}
  if (body.allowed === '*') input.allowed = '*'
  else if (Array.isArray(body.allowed)) input.allowed = body.allowed.filter((s): s is string => typeof s === 'string')
  if (typeof body.is_admin === 'boolean') input.is_admin = body.is_admin
  if (typeof body.disabled === 'boolean') input.disabled = body.disabled
  if (typeof body.password === 'string' && body.password) input.password = body.password

  if (Object.keys(input).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  try {
    const guardUsers = await getGuardUsers()
    const guard = checkSelfLockout(guardUsers, admin.login, id, { is_admin: input.is_admin, disabled: input.disabled })
    if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 422 })

    const { user, error } = await updateUser(id, input)
    if (error) return NextResponse.json({ error }, { status: 503 })
    return NextResponse.json({ user })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
