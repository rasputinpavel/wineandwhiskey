'use client'

const ENV = [
  {
    service: 'bot/ (Chip & Dale)',
    vars: ['LOYVERSE_API_TOKEN', 'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'NOTIFY_CHAT_IDS'],
  },
  {
    service: 'barrymore/',
    vars: ['BARRYMORE_BOT_TOKEN', 'BARRYMORE_CHAT_ID', 'BARRYMORE_USERS', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
  },
  {
    service: 'price-service',
    vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'STOREFRONT_API_KEY', 'STOREFRONT_ALLOWED_ORIGINS'],
  },
  {
    service: 'trendwatch',
    vars: ['TRENDWATCH_SECRET', 'TRENDWATCH_PASSWORD', 'TRENDWATCH_URL', 'RUNWAY_API_TOKEN', 'APIFY_TOKEN', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'BARRYMORE_BOT_TOKEN', 'BARRYMORE_CHAT_ID'],
  },
  {
    service: 'mission-control (this)',
    vars: ['MC_PASSWORD', 'MC_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
  },
  {
    service: 'automation scripts (root)',
    vars: ['LOYVERSE_API_TOKEN', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
  },
]

export function EnvPanel() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <h2 className="font-display text-3xl tracking-display text-deep-black uppercase mb-2">
          Секреты и ENV
        </h2>
        <p className="text-graphite text-sm mb-8">
          Справочник по env-переменным для каждого сервиса. Не хранит сами значения —
          только имена. Значения живут в <code className="font-mono text-xs">.env.local</code> и Railway.
        </p>

        <div className="space-y-4">
          {ENV.map(g => (
            <div key={g.service} className="bg-warm-white border border-pale-stone rounded-md p-5">
              <div className="font-heading font-semibold text-deep-black text-sm mb-3">
                {g.service}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.vars.map(v => (
                  <code key={v} className="font-mono text-xs px-2 py-1 bg-cream text-graphite rounded-sm border border-pale-stone">
                    {v}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
