import { sbInventory } from '@/lib/supabase'
import { SchemaError } from '@/components/modules/inventory/SchemaError'

export const dynamic = 'force-dynamic'

type LocationRow = {
  id: string
  name: string
  customer_id: string
}

export default async function ConsignmentPage() {
  const { data, error } = await sbInventory
    .from('consignment_location')
    .select('id, name, customer_id')
    .order('name')

  if (error) return <SchemaError error={error.message} />
  const locations = (data ?? []) as LocationRow[]

  return (
    <>
      <h2 className="font-heading text-xl text-deep-black mb-6">Consignment</h2>
      {locations.length === 0 ? (
        <div className="text-graphite text-sm">
          Нет точек консигнации. Добавь Golden Brewery через SQL editor или дождись Phase 2 admin UI.
        </div>
      ) : (
        <ul className="space-y-2">
          {locations.map(l => (
            <li key={l.id} className="bg-warm-white border border-pale-stone rounded-md p-4">
              <div className="font-heading text-base text-deep-black">{l.name}</div>
              <div className="text-graphite text-xs mt-1">balance + delivery notes — coming Phase 2</div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
