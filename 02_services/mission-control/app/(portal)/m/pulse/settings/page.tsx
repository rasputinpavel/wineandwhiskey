import { redirect } from 'next/navigation'

// The fixed-cost editor moved to its own top-level section (Fixed Costs).
// Keep this route working for old links / the Pulse "Settings" button.
export default function PulseSettingsPage() {
  redirect('/m/fixed-costs')
}
