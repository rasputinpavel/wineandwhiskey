import { describe, expect, it } from 'vitest'
import { valuesAfter } from './args'

describe('valuesAfter', () => {
  it('stops at the next flag, in flag-then-values order', () => {
    const args = ['--on', 'a', 'b', '--off', 'c']
    expect(valuesAfter(args, '--on')).toEqual(['a', 'b'])
    expect(valuesAfter(args, '--off')).toEqual(['c'])
  })

  it('stops at the next flag, in values-then-flag order (previously broken)', () => {
    // Before the fix, the earlier flag's values leaked into every later flag
    // because the old implementation filtered `--`-prefixed tokens out of the
    // *entire* remainder instead of stopping at the first one.
    const args = ['--off', 'c', '--on', 'a', 'b']
    expect(valuesAfter(args, '--off')).toEqual(['c'])
    expect(valuesAfter(args, '--on')).toEqual(['a', 'b'])
  })

  it('returns an empty list when the flag is absent', () => {
    expect(valuesAfter(['--on', 'a'], '--off')).toEqual([])
  })

  it('returns an empty list when the flag is the last token', () => {
    expect(valuesAfter(['--on', 'a', '--off'], '--off')).toEqual([])
  })

  it('collects every value after a single flag', () => {
    expect(valuesAfter(['--on', 'a', 'b', 'c'], '--on')).toEqual(['a', 'b', 'c'])
  })
})
