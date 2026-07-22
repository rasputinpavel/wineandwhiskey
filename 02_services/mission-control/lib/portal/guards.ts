// Self-lockout protection for user administration. Pure over the current user
// list + the proposed change, so it's enforced in the API (not just the UI).

export type GuardUser = { id: string; login: string; is_admin: boolean; disabled: boolean }
export type GuardChange = { is_admin?: boolean; disabled?: boolean }
export type GuardResult = { ok: true } | { ok: false; reason: string }

/**
 * @param users     current users (from DB)
 * @param actorLogin login of the admin making the change
 * @param targetId   id of the user being changed
 * @param change     proposed field changes
 */
export function checkSelfLockout(
  users: GuardUser[], actorLogin: string, targetId: string, change: GuardChange,
): GuardResult {
  const target = users.find(u => u.id === targetId)
  if (!target) return { ok: true } // creation / unknown target — nothing to protect

  const isSelf = target.login === actorLogin

  if (isSelf && change.is_admin === false) {
    return { ok: false, reason: 'You cannot remove your own admin rights.' }
  }
  if (isSelf && change.disabled === true) {
    return { ok: false, reason: 'You cannot disable your own account.' }
  }

  // Last-enabled-admin protection: block a change that would drop the count of
  // enabled admins to zero.
  const losesAdmin = target.is_admin && (change.is_admin === false || change.disabled === true)
  if (losesAdmin) {
    const enabledAdmins = users.filter(u => u.is_admin && !u.disabled)
    const remaining = enabledAdmins.filter(u => u.id !== target.id)
    if (remaining.length === 0) {
      return { ok: false, reason: 'This is the last active admin — cannot demote or disable.' }
    }
  }

  return { ok: true }
}
