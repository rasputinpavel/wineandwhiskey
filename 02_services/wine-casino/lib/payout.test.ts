import { describe, it, expect } from 'vitest'
import { settleRound } from './payout'
import { DEFAULT_CATEGORIES } from './categories'
import type { PlacedBet } from './payout'

const answers = { style: 'dry', world: 'old', country: 'italy', vintage: '2019' }

function run(bets: PlacedBet[], players: Array<{ id: string; chips: number }>, rescueChips = 10) {
  return settleRound({ bets, answers, categories: DEFAULT_CATEGORIES, players, rescueChips })
}

describe('settleRound', () => {
  it('pays the stake times the category multiplier on a correct bet', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'italy', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(true)
    expect(r.bets[0].payout).toBe(40)                 // 10 x4
    expect(r.players[0].chipsAfter).toBe(130)         // 100 - 10 + 40
  })

  it('burns the stake on a wrong bet', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'france', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(false)
    expect(r.bets[0].payout).toBe(0)
    expect(r.players[0].chipsAfter).toBe(90)
  })

  it('compares answers case- and whitespace-insensitively', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: '  ITALY ', amount: 10 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBe(true)
  })

  it('rounds a fractional multiplier to the nearest chip', () => {
    // style pays x1.5; 5 chips -> 7.5 -> 8.
    const r = run([{ playerId: 'p1', category: 'style', option: 'dry', amount: 5 }], [{ id: 'p1', chips: 50 }])
    expect(r.bets[0].payout).toBe(8)
    expect(r.players[0].chipsAfter).toBe(53)
  })

  it('settles a hedge across two options in one category', () => {
    const r = run(
      [
        { playerId: 'p1', category: 'world', option: 'old', amount: 20 },
        { playerId: 'p1', category: 'world', option: 'new', amount: 20 },
      ],
      [{ id: 'p1', chips: 100 }],
    )
    expect(r.players[0].staked).toBe(40)
    expect(r.players[0].won).toBe(40)                 // 20 x2 on 'old', nothing on 'new'
    expect(r.players[0].chipsAfter).toBe(100)         // hedging the coin flip is break-even
  })

  it('voids a bet when we have no answer on file and hands the stake back', () => {
    // 'grape' is a live category but this wine has no grape recorded.
    const r = run([{ playerId: 'p1', category: 'grape', option: 'merlot', amount: 30 }], [{ id: 'p1', chips: 100 }])
    expect(r.bets[0].isCorrect).toBeNull()
    expect(r.bets[0].payout).toBe(30)
    expect(r.players[0].chipsAfter).toBe(100)
  })

  it('voids a bet in a category the game does not run', () => {
    const r = settleRound({
      bets: [{ playerId: 'p1', category: 'vintage', option: '2019', amount: 30 }],
      answers,
      categories: DEFAULT_CATEGORIES.filter(c => c.key !== 'vintage'),
      players: [{ id: 'p1', chips: 100 }],
      rescueChips: 10,
    })
    expect(r.bets[0].isCorrect).toBeNull()
    expect(r.players[0].chipsAfter).toBe(100)
  })

  it('leaves a player who passed exactly where they were', () => {
    const r = run([], [{ id: 'p1', chips: 73 }])
    expect(r.players[0]).toMatchObject({ chipsAfter: 73, staked: 0, won: 0, rescued: false })
  })

  it('hands rescue chips to a player who bet everything and lost', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'chile', amount: 40 }], [{ id: 'p1', chips: 40 }])
    expect(r.players[0].chipsAfter).toBe(10)
    expect(r.players[0].rescued).toBe(true)
  })

  it('rescues a player who is already at zero and could not bet', () => {
    const r = run([], [{ id: 'p1', chips: 0 }])
    expect(r.players[0].chipsAfter).toBe(10)
    expect(r.players[0].rescued).toBe(true)
  })

  it('does not rescue a player who merely lost some chips', () => {
    const r = run([{ playerId: 'p1', category: 'country', option: 'chile', amount: 40 }], [{ id: 'p1', chips: 100 }])
    expect(r.players[0].chipsAfter).toBe(60)
    expect(r.players[0].rescued).toBe(false)
  })

  it('settles every player in the game, including ones with no bets', () => {
    const r = run(
      [{ playerId: 'p1', category: 'world', option: 'old', amount: 10 }],
      [{ id: 'p1', chips: 100 }, { id: 'p2', chips: 100 }],
    )
    expect(r.players.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(r.players[1].chipsAfter).toBe(100)
  })

  it('never mutates the inputs', () => {
    const players = [{ id: 'p1', chips: 100 }]
    const bets: PlacedBet[] = [{ playerId: 'p1', category: 'world', option: 'old', amount: 10 }]
    run(bets, players)
    expect(players[0].chips).toBe(100)
    expect(bets[0]).toEqual({ playerId: 'p1', category: 'world', option: 'old', amount: 10 })
  })
})
