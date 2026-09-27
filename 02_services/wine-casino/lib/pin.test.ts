import { describe, it, expect } from 'vitest'
import { generatePin, uniqueNickname } from './pin'

describe('generatePin', () => {
  it('always produces six digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePin()).toMatch(/^\d{6}$/)
    }
  })

  it('never starts with a zero — guests mistype leading zeros', () => {
    expect(generatePin(() => 0)).toBe('100000')
  })

  it('uses the whole range', () => {
    expect(generatePin(() => 0.999999)).toBe('999999')
  })
})

describe('uniqueNickname', () => {
  it('keeps a free name as typed', () => {
    expect(uniqueNickname('Аня', ['Пётр'])).toBe('Аня')
  })

  it('numbers a duplicate', () => {
    expect(uniqueNickname('Аня', ['Аня'])).toBe('Аня (2)')
  })

  it('keeps counting past the first duplicate', () => {
    expect(uniqueNickname('Аня', ['Аня', 'Аня (2)'])).toBe('Аня (3)')
  })

  it('treats case and padding as the same name', () => {
    expect(uniqueNickname('  аня  ', ['АНЯ'])).toBe('аня (2)')
  })

  it('falls back to a default for an empty name', () => {
    expect(uniqueNickname('   ', [])).toBe('Гость')
  })

  it('truncates a very long name so it fits the leaderboard', () => {
    expect(uniqueNickname('a'.repeat(50), [])).toHaveLength(24)
  })
})
