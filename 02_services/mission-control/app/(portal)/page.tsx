import { redirect } from 'next/navigation'
import { DEFAULT_ROUTE } from '@/lib/registry'

export default function PortalIndex() {
  redirect(DEFAULT_ROUTE)
}
