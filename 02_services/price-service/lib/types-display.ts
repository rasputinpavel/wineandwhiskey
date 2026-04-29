// Single source of truth for human-readable labels of wine_type and spirit_type.
// Used by FilterBar (filter chips) and PriceTable (cell rendering).

export const WINE_TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  red:       { label: 'Красное',  emoji: '🔴' },
  white:     { label: 'Белое',    emoji: '⚪' },
  rose:      { label: 'Розовое',  emoji: '🌸' },
  orange:    { label: 'Оранжевое', emoji: '🟠' },
  sparkling: { label: 'Игристое', emoji: '✨' },
}

export const SPIRIT_TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  whisky:      { label: 'Виски',     emoji: '🥃' },
  cognac:      { label: 'Коньяк',    emoji: '🥃' },
  brandy:      { label: 'Бренди',    emoji: '🥃' },
  armagnac:    { label: 'Арманьяк',  emoji: '🥃' },
  calvados:    { label: 'Кальвадос', emoji: '🥃' },
  vodka:       { label: 'Водка',     emoji: '🍶' },
  gin:         { label: 'Джин',      emoji: '🍸' },
  rum:         { label: 'Ром',       emoji: '🥃' },
  tequila:     { label: 'Текила',    emoji: '🌵' },
  grappa:      { label: 'Граппа',    emoji: '🍷' },
  liqueur:     { label: 'Ликёр',     emoji: '🍯' },
  shochu:      { label: 'Сётю',      emoji: '🍶' },
  sake:        { label: 'Саке',      emoji: '🍶' },
  vermouth:    { label: 'Вермут',    emoji: '🍷' },
  aperitif:    { label: 'Аперитив',  emoji: '🍹' },
  bitters:     { label: 'Биттер',    emoji: '🥃' },
  amaro:       { label: 'Амаро',     emoji: '🌿' },
  digestif:    { label: 'Дижестив',  emoji: '🌿' },
  'eau-de-vie': { label: 'О-де-ви',  emoji: '🥃' },
  other:       { label: 'Прочее',    emoji: '🥃' },
}

export function wineTypeLabel(t: string | null | undefined): string {
  if (!t) return ''
  const meta = WINE_TYPE_LABELS[t]
  return meta ? `${meta.emoji} ${meta.label}` : t
}

// Single emoji that represents the high-level category. Used as a visual
// scanning aid in the price table when scrolling lots of rows.
export function categoryEmoji(category: string | null | undefined): string {
  switch (category) {
    case 'spirits': return '🥃'
    case 'beer':    return '🍺'
    case 'other':   return '🥤'
    case 'wine':
    default:        return '🍷'
  }
}

export function spiritTypeLabel(t: string | null | undefined): string {
  if (!t) return ''
  const meta = SPIRIT_TYPE_LABELS[t]
  return meta ? `${meta.emoji} ${meta.label}` : t
}
