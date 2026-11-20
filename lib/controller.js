'use strict'
// One project window's game: the board (lib/game.js), its clock, the Claude pause and the best times, with no
// ctx in it (`now` and `rng` injected), so `test/controller.test.js` drives it with a fake clock. dist/host.js
// wires it to ctx: page messages in, `snapshot()` out to every view, session lists in, records out to storage.
//
// The clock is the host's, not the page's: the page may be closed or hidden while a game runs (or paused), and
// a paused game must stay paused and its time stopped whatever the panel does.

const game = require('./game.js')
const { createReadyWatch } = require('./pause.js')

function createController({ now = Date.now, rng = Math.random, size } = {}) {
  let g = game.newGame(size)
  let elapsed = 0 // ms counted before `since`
  let since = null // when the clock last started; null while it stands
  /** The Claude tab the pause is about, `{ tabId, name }`, or null when the game is not paused. */
  let paused = null
  /** Whole seconds per size, from storage (`setBest`) and this window's wins. */
  const best = {}
  let record = false // the game just won set a new best
  const watch = createReadyWatch()

  const elapsedMs = () => elapsed + (since === null ? 0 : now() - since)
  const stopClock = () => {
    elapsed = elapsedMs()
    since = null
  }

  function reset(nextSize) {
    g = game.newGame(nextSize === undefined ? g.size : nextSize)
    elapsed = 0
    since = null
    paused = null
    record = false
  }

  /** After a move: start the clock at the first open, stop it at the end; a win may make a record. */
  function afterMove(wasReady) {
    if (wasReady && g.status !== 'ready') since = now()
    if (!game.over(g)) return null
    stopClock()
    if (g.status !== 'won') return null
    const seconds = Math.floor(elapsed / 1000)
    const prev = best[g.size]
    record = typeof prev !== 'number' || seconds < prev
    if (record) best[g.size] = seconds
    return record ? { size: g.size, seconds } : null
  }

  return {
    /** The whole state the page draws. Never where the mines are (game.view), never a tab id. */
    snapshot() {
      return {
        size: g.size,
        sizes: game.SIZE_IDS.map((id) => ({ id, ...game.SIZES[id] })),
        w: g.w,
        h: g.h,
        mines: g.mines,
        minesLeft: g.mines - g.flags,
        cells: game.view(g),
        status: g.status,
        elapsedMs: elapsedMs(),
        running: since !== null,
        paused: paused ? { name: paused.name } : null,
        record,
        best: Object.fromEntries(game.SIZE_IDS.map((id) => [id, typeof best[id] === 'number' ? best[id] : null])),
      }
    },

    /**
     * One page action, untrusted. Returns `{ changed, record? }`: `record` `{ size, seconds }` when a win set a
     * new best (the host stores it). Moves are refused while paused: only Resume or New game goes on.
     */
    act(msg) {
      if (!msg || typeof msg !== 'object') return { changed: false }
      switch (msg.act) {
        case 'open':
        case 'flag': {
          if (paused) return { changed: false }
          const wasReady = g.status === 'ready'
          const changed = msg.act === 'open' ? game.open(g, msg.i, rng) : game.flag(g, msg.i)
          if (!changed) return { changed: false }
          const rec = afterMove(wasReady)
          return rec ? { changed: true, record: rec } : { changed: true }
        }
        case 'new':
          if (msg.size !== undefined && !game.isSize(msg.size)) return { changed: false }
          reset(msg.size)
          return { changed: true }
        case 'resume':
          if (!paused) return { changed: false }
          paused = null
          since = now()
          return { changed: true }
        default:
          return { changed: false }
      }
    },

    /**
     * The window's Claude tabs (every `ctx.sessions` list). A tab going from working to waiting pauses a game in
     * play; while paused, a later one only renames the cover to it (the latest wins). A game not started or over
     * is never paused, and a transition seen before the game started does not count later. Returns whether the
     * state changed.
     */
    sessions(list) {
      const ready = watch.observe(list)
      if (ready.length === 0) return false
      const latest = ready[ready.length - 1]
      if (paused) {
        if (paused.tabId === latest.tabId && paused.name === latest.name) return false
        paused = latest
        return true
      }
      if (g.status !== 'play') return false
      stopClock()
      paused = latest
      return true
    },

    /** The tab the pause names, for Go to the tab; null when not paused. */
    pausedTab: () => (paused ? paused.tabId : null),

    /** Best times from storage: `{ size: seconds }`; a stored value only lowers what this window knows. */
    setBest(stored) {
      let changed = false
      for (const id of game.SIZE_IDS) {
        const v = stored && stored[id]
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
        if (typeof best[id] !== 'number' || v < best[id]) {
          best[id] = Math.floor(v)
          changed = true
        }
      }
      return changed
    },

    size: () => g.size,
  }
}

module.exports = { createController }
