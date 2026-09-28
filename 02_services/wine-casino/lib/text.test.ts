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

  it('does not strip inner spacing or punctuation that distinguishes real answers', () => {
    expect(canon('Ribera del Duero')).toBe('ribera del duero')
    expect(canon('Hawke\'s Bay')).toBe('hawke\'s bay')
  })
})
