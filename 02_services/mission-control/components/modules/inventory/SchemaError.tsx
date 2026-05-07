// Show a friendly hint when the inventory schema isn't reachable yet —
// either env vars missing or migration not applied.

export function SchemaError({ error }: { error: string }) {
  const looksLikeMissingTable =
    /relation|schema|does not exist|inventory/i.test(error)

  return (
    <div className="bg-warm-white border border-amber-gold rounded-md p-6 my-6">
      <div className="overline text-amber-gold mb-2">Database not ready</div>
      <h3 className="font-heading text-lg text-deep-black mb-3">
        Не могу прочитать данные из Supabase
      </h3>
      <p className="text-sm text-graphite leading-relaxed mb-4">
        {looksLikeMissingTable
          ? 'Похоже, схема inventory ещё не применена в Supabase, или mission-control смотрит не в тот проект.'
          : 'Возможно, не заданы переменные окружения SUPABASE_URL / SUPABASE_SERVICE_KEY.'}
      </p>
      <details className="text-xs text-graphite">
        <summary className="cursor-pointer hover:text-wine-red">Что нужно сделать</summary>
        <ol className="mt-3 space-y-1 list-decimal pl-5">
          <li>В <code className="font-mono">.env.local</code> mission-control — добавить <code className="font-mono">SUPABASE_URL</code> и <code className="font-mono">SUPABASE_SERVICE_KEY</code> (можно скопировать из корневого .env.local).</li>
          <li>В Supabase SQL editor применить <code className="font-mono">02_services/inventory/supabase/migrations/001_inventory.sql</code>.</li>
          <li>В Supabase Dashboard → API → Exposed schemas — добавить <code className="font-mono">inventory</code>.</li>
          <li>Запустить sync: <code className="font-mono">npm run inv:all</code> из корня репо.</li>
        </ol>
      </details>
      <pre className="mt-4 text-[11px] text-wine-red font-mono bg-cream/50 p-3 rounded-sm overflow-x-auto">
{error}
      </pre>
    </div>
  )
}
