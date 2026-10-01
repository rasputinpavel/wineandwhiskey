import { describe, it, expect } from 'vitest'
import { canon } from './text'

describe('canon', () => {
  it('ignores casing and padding, which is all a human typing a wine name adds', () => {
    expect(canon('  ITALY ')).toBe('italy')
    expect(canon('Bekaa Valley')).toBe('bekaa valley')
  })

  it('leaves an already-canonical value untouched, so it is safe to apply twice', () => {
    expect(canon(canon('  Saperavi '))).toBe(canon('  Saperavi '))
  })

  it('folds accents, because our own labels carry them and our own keys do not', () => {
    // Picked from our own grape list, this must find its own entry.
    expect(canon('Müller-Thurgau')).toBe('muller-thurgau')
    expect(canon('Carménère')).toBe('carmenere')
    expect(canon('Ștefan Vodă')).toBe('stefan voda')
    expect(canon('Rías Baixas')).toBe('rias baixas')
  })

  it('leaves Cyrillic alone where there is nothing to fold', () => {
    expect(canon('  Кубань ')).toBe('кубань')
  })

  it('does not strip inner spacing or punctuation that distinguishes real answers', () => {
    expect(canon('Ribera del Duero')).toBe('ribera del duero')
    expect(canon('Hawke\'s Bay')).toBe('hawke\'s bay')
  })
})
