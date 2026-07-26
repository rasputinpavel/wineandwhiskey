import { describe, it, expect } from 'vitest'
import { zoneFromWineColor, zoneToken, PLAQUE_TOKENS } from './plaques'

describe('zoneFromWineColor', () => {
  it('maps direct colors', () => {
    expect(zoneFromWineColor('red')).toBe('red')
    expect(zoneFromWineColor('white')).toBe('white')
    expect(zoneFromWineColor('sparkling')).toBe('sparkling')
    expect(zoneFromWineColor('rose')).toBe('rose')
  })
  it('folds orange into the white zone (v1)', () => {
    expect(zoneFromWineColor('orange')).toBe('white')
  })
  it('defaults unknown/nullish to white', () => {
    expect(zoneFromWineColor(null)).toBe('white')
    expect(zoneFromWineColor(undefined)).toBe('white')
    expect(zoneFromWineColor('grape-juice')).toBe('white')
  })
})

describe('zoneToken', () => {
  it('returns the brand token hex per zone', () => {
    expect(zoneToken('red')).toBe(PLAQUE_TOKENS.red)
    expect(zoneToken('spirits')).toBe('#3D3D3D')
    expect(zoneToken('rose')).toBe('#C98C8C')
  })
})
