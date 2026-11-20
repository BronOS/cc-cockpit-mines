'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const G = require('../lib/game.js')

/** A seeded [0, 1) generator, so a failing seed can be replayed. */
function rngOf(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A game with mines exactly where given (status play), for hand-made boards. */
function boardWith(size, mineCells) {
  const g = G.newGame(size)
  for (const i of mineCells) g.cells[i].mine = true
  g.mines = mineCells.length
  g.cells.forEach((c, i) => {
    c.n = G.neighbours(g, i).filter((j) => g.cells[j].mine).length
  })
  g.status = 'play'
  return g
}

test('sizes: small 9x9/10, medium 12x12/22, large 16x16/40; junk falls back to medium', () => {
  assert.deepEqual(
    G.SIZE_IDS.map((id) => [id, G.SIZES[id].w, G.SIZES[id].h, G.SIZES[id].mines]),
    [['small', 9, 9, 10], ['medium', 12, 12, 22], ['large', 16, 16, 40]],
  )
  assert.equal(G.newGame('large').cells.length, 256)
  assert.equal(G.newGame('__proto__').size, 'medium')
  assert.equal(G.newGame(undefined).size, 'medium')
  assert.equal(G.isSize('toString'), false)
})

test('neighbours: 3 in a corner, 5 on an edge, 8 inside', () => {
  const g = G.newGame('small')
  assert.deepEqual(G.neighbours(g, 0).sort((a, b) => a - b), [1, 9, 10])
  assert.equal(G.neighbours(g, 4).length, 5)
  assert.equal(G.neighbours(g, 40).length, 8)
  assert.deepEqual(G.neighbours(g, 80).sort((a, b) => a - b), [70, 71, 79])
})

test('planting: the right number of mines, never on the first cell or its neighbours, counts right', () => {
  for (const size of G.SIZE_IDS) {
    for (let seed = 1; seed <= 200; seed++) {
      const g = G.newGame(size)
      const first = Math.floor(rngOf(seed * 7)() * g.cells.length)
      G.plant(g, first, rngOf(seed))
      assert.equal(g.cells.filter((c) => c.mine).length, g.mines, `${size} seed ${seed}`)
      for (const i of [first, ...G.neighbours(g, first)]) assert.equal(g.cells[i].mine, false, `${size} seed ${seed} cell ${i}`)
      g.cells.forEach((c, i) => {
        assert.equal(c.n, G.neighbours(g, i).filter((j) => g.cells[j].mine).length)
      })
    }
  }
})

test('planting ends even with an rng that always answers the same', () => {
  const g = G.newGame('medium')
  G.plant(g, 0, () => 0.999999)
  assert.equal(g.cells.filter((c) => c.mine).length, 22)
})

test('first open plants, starts the game and opens an area (its cell has no mine neighbours)', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const g = G.newGame('large')
    assert.equal(G.open(g, 100, rngOf(seed)), true)
    assert.equal(g.status === 'play' || g.status === 'won', true)
    assert.equal(g.cells[100].n, 0)
    assert.ok(g.opened >= 9, `seed ${seed}: opened ${g.opened}`)
    for (const j of G.neighbours(g, 100)) assert.equal(g.cells[j].open, true)
  }
})

test('flood fill opens zeros and stops at numbers, never past a flag', () => {
  // small (9x9) with one mine in the bottom-right corner: everything but that corner opens from the far corner.
  const g = boardWith('small', [80])
  G.flag(g, 40)
  assert.equal(G.open(g, 0), true)
  assert.equal(g.cells[40].open, false, 'flagged cell stays closed')
  assert.equal(g.cells[80].open, false)
  assert.equal(g.cells[70].open, true)
  assert.equal(g.cells[70].n, 1)
  assert.equal(g.opened, 81 - 1 - 1)
  assert.equal(g.status, 'play')
  G.flag(g, 40)
  G.open(g, 40)
  assert.equal(g.status, 'won')
})

test('opening a mine loses: the mine is marked, other mines shown, wrong flags marked', () => {
  const g = boardWith('small', [0, 10, 80])
  G.flag(g, 10) // right
  G.flag(g, 40) // wrong: no mine there
  assert.equal(G.open(g, 0), true)
  assert.equal(g.status, 'lost')
  const v = G.view(g)
  assert.equal(v[0], 'b')
  assert.equal(v[10], 'f')
  assert.equal(v[40], 'x')
  assert.equal(v[80], 'm')
  // Nothing moves once over.
  assert.equal(G.open(g, 50), false)
  assert.equal(G.flag(g, 50), false)
})

test('the view never shows a mine before the game is lost', () => {
  const g = boardWith('small', [0, 80])
  G.open(g, 40)
  assert.equal(/[mbx]/.test(G.view(g)), false)
})

test('chord: a number with all its flags placed opens its other neighbours; too few flags does nothing', () => {
  // Mines at (0,0)=0 and (2,0)=2: cell (1,1)=10 counts 2.
  const g = boardWith('small', [0, 2])
  G.open(g, 10)
  assert.equal(g.cells[10].n, 2)
  assert.equal(g.opened, 1)
  G.flag(g, 0)
  assert.equal(G.open(g, 10), false, 'one flag of two: no chord')
  G.flag(g, 2)
  assert.equal(G.open(g, 10), true, 'open on an open number chords')
  for (const j of [1, 9, 11, 18, 19, 20]) assert.equal(g.cells[j].open, true, `cell ${j}`)
  assert.equal(g.status === 'play' || g.status === 'won', true)
})

test('chord with a misplaced flag opens the mine and loses', () => {
  const g = boardWith('small', [0, 2])
  G.open(g, 10)
  G.flag(g, 0)
  G.flag(g, 20) // wrong; 2 is the mine
  assert.equal(G.chord(g, 10), true)
  assert.equal(g.status, 'lost')
  assert.equal(g.boom, 2)
})

test('chord on a zero, a hidden cell or junk does nothing', () => {
  const g = boardWith('small', [80])
  G.open(g, 0)
  assert.equal(G.chord(g, 0), false)
  assert.equal(G.chord(g, 80), false)
  assert.equal(G.chord(g, -1), false)
  assert.equal(G.chord(g, 'x'), false)
})

test('win: every cell without a mine open; flags are not needed', () => {
  const g = boardWith('small', [0])
  G.open(g, 80)
  assert.equal(g.status, 'won')
  assert.equal(g.flags, 0)
})

test('flags: toggle on a hidden cell, count up and down, never on an open cell; allowed before the first open', () => {
  const g = G.newGame('small')
  assert.equal(G.flag(g, 5), true)
  assert.equal(g.flags, 1)
  assert.equal(G.view(g)[5], 'f')
  assert.equal(G.open(g, 5), false, 'a flagged cell does not open')
  assert.equal(g.status, 'ready')
  assert.equal(G.flag(g, 5), true)
  assert.equal(g.flags, 0)
  G.open(g, 40, rngOf(3))
  const openCell = g.cells.findIndex((c) => c.open)
  assert.equal(G.flag(g, openCell), false)
  assert.equal(g.flags, 0)
})

test('moves with a junk index are refused and change nothing', () => {
  const g = G.newGame('small')
  for (const i of [-1, 81, 1.5, '3', null, undefined, NaN]) {
    assert.equal(G.open(g, i), false)
    assert.equal(G.flag(g, i), false)
  }
  assert.equal(g.status, 'ready')
})
