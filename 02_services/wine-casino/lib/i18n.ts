import type { Lang } from './types'

// Only the guest surface is translated. Host and admin are English-only, like
// the rest of the portal — they are used by us, not by the room.
const STRINGS = {
  joinTitle:        { ru: 'Винное казино',            en: 'Wine Casino' },
  joinPin:          { ru: 'Код игры',                 en: 'Game PIN' },
  joinName:         { ru: 'Ваше имя',                 en: 'Your name' },
  joinButton:       { ru: 'Войти в казино',           en: 'Enter the casino' },
  joinNotFound:     { ru: 'Игра не найдена',          en: 'Game not found' },
  joinClosed:       { ru: 'Игра уже завершена',       en: 'This game has finished' },
  lobbyWaiting:     { ru: 'Ждём ведущего…',           en: 'Waiting for the host…' },
  lobbyPlayers:     { ru: 'За столом',                en: 'At the table' },
  bank:             { ru: 'Банк',                     en: 'Bank' },
  onTable:          { ru: 'На столе',                 en: 'On the table' },
  available:        { ru: 'Доступно',                 en: 'Available' },
  placeBet:         { ru: 'Ставлю',                   en: 'Place bets' },
  betsSaved:        { ru: 'Ставки приняты',           en: 'Bets accepted' },
  betsClosed:       { ru: 'Ставки закрыты',           en: 'Betting closed' },
  clearAll:         { ru: 'Сбросить',                 en: 'Clear' },
  hint:             { ru: 'Подсказка',                en: 'Hint' },
  roundOf:          { ru: 'Вино',                     en: 'Wine' },
  youWon:           { ru: 'Выигрыш',                  en: 'Won' },
  youStaked:        { ru: 'Поставлено',               en: 'Staked' },
  rescued:          { ru: 'Казино дарит вам фишки на следующий кон', en: 'The house stakes you for the next round' },
  correct:          { ru: 'Угадали',                  en: 'Correct' },
  wrong:            { ru: 'Мимо',                     en: 'Missed' },
  voided:           { ru: 'Ставка возвращена',        en: 'Bet returned' },
  leaderboard:      { ru: 'Таблица лидеров',          en: 'Leaderboard' },
  finished:         { ru: 'Игра окончена',            en: 'Game over' },
  winner:           { ru: 'Победитель',               en: 'Winner' },
  reconnecting:     { ru: 'Восстанавливаем связь…',   en: 'Reconnecting…' },
  errBank:          { ru: 'Не хватает фишек',         en: 'Not enough chips' },
  errClosed:        { ru: 'Раунд уже закрыт',         en: 'The round is already closed' },
  errGeneric:       { ru: 'Не получилось. Попробуйте ещё раз', en: 'Something went wrong. Try again' },
} as const

export type StringKey = keyof typeof STRINGS

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key][lang]
}

/** Picks the right side of any {ru, en} pair — options, hints, category labels. */
export function pick(pair: { ru: string; en: string }, lang: Lang): string {
  return lang === 'ru' ? pair.ru : pair.en
}
