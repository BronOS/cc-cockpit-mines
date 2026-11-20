'use strict'
// The Mines game itself: a board, its moves and how a game ends. Pure (no ctx, no clock, no DOM), so
// `test/game.test.js` runs every rule under node. The host owns one game per project window
// (lib/controller.js) and the page only draws `view(game)`: a page can be closed, hidden or open in two
// views at once, and the game must outlive all of that.
//
// A game is a plain object mutated in place by `open` and `flag`. Moves arrive from the page, which is
// untrusted input, so every move checks its index and is a no-op when it does not apply (the game is over,
// the cell is open, the index is junk) and says whether anything changed.

const SIZES = Object.freeze({
  small: Object.freeze({ label: 'Small', w: 9, h: 9, mines: 10 }),
  medium: Object.freeze({ label: 'Medium', w: 12, h: 12, mines: 22 }),
  large: Object.freeze({ label: 'Large', w: 16, h: 16, mines: 40 }),
  // Past 16 columns a side panel is too narrow for usable cells: the board keeps a 16 px minimum cell and
  // scrolls sideways (mines.css), so these are best in a wide zone or with the panel dragged wider.
  huge: Object.freeze({ label: 'Huge', w: 24, h: 24, mines: 99 }),
  wide: Object.freeze({ label: 'Wide', w: 30, h: 16, mines: 99 }),
})
const SIZE_IDS = Object.freeze(Object.keys(SIZES))
const DEFAULT_SIZE = 'medium'

/** An own key of SIZES (never `__proto__` or `toString`). */
const isSize = (size) => typeof size === 'string' && Object.prototype.hasOwnProperty.call(SIZES, size)

/**
 * A fresh board. Mines are planted only at the first open (`plant`), so that cell and its neighbours can be
 * kept clear. `status`: `ready` (nothing opened yet), `play`, `won`, `lost`.
 */
function newGame(size) {
  const s = SIZES[isSize(size) ? size : DEFAULT_SIZE]
  return {
    size: isSize(size) ? size : DEFAULT_SIZE,
    w: s.w,
    h: s.h,
    mines: s.mines,
    cells: Array.from({ length: s.w * s.h }, () => ({ mine: false, n: 0, open: false, flag: false })),
    status: 'ready',
    flags: 0,
    opened: 0,
    boom: -1,
  }
}

const validIndex = (game, i) => Number.isInteger(i) && i >= 0 && i < game.cells.length

/** The up to 8 cells around `i`. */
function neighbours(game, i) {
  const x = i % game.w
  const y = Math.floor(i / game.w)
  const out = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx
      const ny = y + dy
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < game.w && ny < game.h) out.push(ny * game.w + nx)
    }
  }
  return out
}

/**
 * Plants the mines, never on `safe` or its neighbours, so the first open always opens an area, then counts
 * each cell's mine neighbours. `rng` returns [0, 1) like Math.random (tests pass a seeded one). A cell is
 * drawn from the free ones only, so it always ends, whatever the rng.
 */
function plant(game, safe, rng = Math.random) {
  const keep = new Set([safe, ...neighbours(game, safe)])
  const free = []
  for (let i = 0; i < game.cells.length; i++) if (!keep.has(i)) free.push(i)
  for (let left = Math.min(game.mines, free.length); left > 0; left--) {
    const k = Math.min(free.length - 1, Math.floor(rng() * free.length))
    game.cells[free[k]].mine = true
    free[k] = free[free.length - 1]
    free.pop()
  }
  game.cells.forEach((c, i) => {
    c.n = neighbours(game, i).filter((j) => game.cells[j].mine).length
  })
}

/** Opens a cell that holds no mine, and the whole area around it when it has no mine neighbours. */
function reveal(game, i) {
  const stack = [i]
  while (stack.length) {
    const k = stack.pop()
    const c = game.cells[k]
    if (c.open || c.flag) continue
    c.open = true
    game.opened++
    if (c.n === 0) stack.push(...neighbours(game, k))
  }
  if (game.opened === game.cells.length - game.mines) game.status = 'won'
}

function lose(game, i) {
  game.status = 'lost'
  game.boom = i
  for (const c of game.cells) if (c.mine && !c.flag) c.open = true
}

const over = (game) => game.status === 'won' || game.status === 'lost'

/**
 * A click (or Space) on a cell: the first one plants and starts the game; on a hidden cell it opens it (a mine
 * loses); on an open number it chords. A flagged cell is left alone. Returns whether anything changed.
 */
function open(game, i, rng = Math.random) {
  if (over(game) || !validIndex(game, i)) return false
  const c = game.cells[i]
  if (c.flag) return false
  if (c.open) return chord(game, i)
  if (game.status === 'ready') {
    plant(game, i, rng)
    game.status = 'play'
  }
  if (c.mine) lose(game, i)
  else reveal(game, i)
  return true
}

/**
 * On an open number whose flags around it are all placed (as many flags as its number), opens every other
 * hidden neighbour. A misplaced flag means one of them is a mine: that loses, as a direct click on it would.
 */
function chord(game, i) {
  if (over(game) || !validIndex(game, i)) return false
  const c = game.cells[i]
  if (!c.open || !c.n) return false
  const around = neighbours(game, i)
  if (around.filter((j) => game.cells[j].flag).length !== c.n) return false
  let changed = false
  for (const j of around) {
    const d = game.cells[j]
    if (d.open || d.flag) continue
    if (d.mine) {
      lose(game, j)
      return true
    }
    reveal(game, j)
    changed = true
    if (over(game)) break
  }
  return changed
}

/** Puts or takes away a flag on a hidden cell (allowed before the first open too). */
function flag(game, i) {
  if (over(game) || !validIndex(game, i)) return false
  const c = game.cells[i]
  if (c.open) return false
  c.flag = !c.flag
  game.flags += c.flag ? 1 : -1
  return true
}

/**
 * What the page draws, one character per cell: `h` hidden, `f` flag, `0`-`8` an open cell's number, and once
 * lost `m` a mine, `b` the mine that went off, `x` a flag on a cell with no mine. Where the mines are is never
 * in it before the game is lost.
 */
function view(game) {
  const lost = game.status === 'lost'
  let out = ''
  game.cells.forEach((c, i) => {
    if (c.flag) out += lost && !c.mine ? 'x' : 'f'
    else if (!c.open) out += 'h'
    else if (c.mine) out += i === game.boom ? 'b' : 'm'
    else out += String(c.n)
  })
  return out
}

module.exports = { SIZES, SIZE_IDS, DEFAULT_SIZE, isSize, newGame, neighbours, plant, open, chord, flag, view, over }
