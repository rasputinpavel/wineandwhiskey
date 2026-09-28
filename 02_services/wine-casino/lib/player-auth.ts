import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { getPlayerSecret } from './db'

/** A bearer token the phone keeps in localStorage. Only its hash is stored, so
 *  a leak of the database does not let anyone bet as someone else. */
export function newPlayerToken(): string {
  return randomBytes(24).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function verifyPlayer(playerId: string, token: string): Promise<boolean> {
  if (!playerId || !token) return false
  const stored = await getPlayerSecret(playerId)
  return stored != null && stored === hashToken(token)
}
