import { cookies } from 'next/headers'
import { verifyToken, COOKIE_NAME, type User } from '@/lib/auth'

// Resolves the current user from the cookie and asserts admin. Returns the user
// or null; routes turn null into a 403.
export async function requireAdmin(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const user = token ? await verifyToken(token) : null
  return user?.is_admin ? user : null
}
