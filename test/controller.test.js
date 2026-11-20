'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createController } = require('../lib/controller.js')
const { createReadyWatch, tabName } = require('../lib/pause.js')

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

const tab = (tabId, status, extra = {}) => ({ tabId, status, cwd: '/p', notes: [], files: [], ...extra })

/** A controller with a game in play (the first open made), on a fake clock. */
function playing() {
  const c = clock()
  const ctl = createController({ now: c.now, rng: () => 0.5, size: 'large' })
  assert.equal(ctl.act({ act: 'open', i: 0 }).changed, true)
  assert.equal(ctl.snapshot().status, 'play')
  return { ctl, c }
}

test('ready watch: only working -> waiting counts, in list order; first sight and other moves do not', () => {
  const w = createReadyWatch()
  assert.deepEqual(w.observe([tab('a', 'waiting'), tab('b', 'working')]), [], 'first sight is no transition')
  assert.deepEqual(w.observe([tab('a', 'working'), tab('b', 'needs-permission')]), [])
  assert.deepEqual(w.observe([tab('a', 'waiting', { title: 'Fix the scroll test' }), tab('b', 'working')]), [
    { tabId: 'a', name: 'Fix the scroll test' },
  ])
  assert.deepEqual(w.observe([tab('a', 'waiting'), tab('b', 'idle')]), [], 'working -> idle is not ready')
  assert.deepEqual(w.observe([tab('b', 'working')]), [])
  assert.deepEqual(w.observe([tab('a', 'waiting'), tab('b', 'waiting')]), [{ tabId: 'b', name: 'A Claude tab' }], 'a gone tab is forgotten')
  assert.deepEqual(w.observe(null), [])
  assert.deepEqual(w.observe([null, { tabId: 3 }, tab('c', 'working')]), [])
})

test('tab name: the person\'s name first, then Claude\'s title, then a plain phrase', () => {
  assert.equal(tabName({ name: 'mine', title: 'theirs' }), 'mine')
  assert.equal(tabName({ name: '  ', title: 'theirs' }), 'theirs')
  assert.equal(tabName({}), 'A Claude tab')
  assert.equal(tabName({ title: 'x'.repeat(500) }).length, 120)
})

test('a tab turning ready during play pauses: the clock stops, moves are refused, Resume goes on', () => {
  const { ctl, c } = playing()
  ctl.sessions([tab('t1', 'working', { title: 'Fix the scroll test' })])
  c.advance(5_000)
  assert.equal(ctl.sessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })]), true)
  let s = ctl.snapshot()
  assert.deepEqual(s.paused, { name: 'Fix the scroll test' })
  assert.equal(s.running, false)
  assert.equal(s.elapsedMs, 5_000)
  assert.equal(ctl.pausedTab(), 't1')
  assert.equal('tabId' in s.paused, false, 'the page never gets a tab id')

  c.advance(60_000) // the panel may be hidden all this time: nothing runs
  const before = s.cells
  assert.equal(ctl.act({ act: 'open', i: 255 }).changed, false)
  assert.equal(ctl.act({ act: 'flag', i: 255 }).changed, false)
  s = ctl.snapshot()
  assert.equal(s.cells, before)
  assert.equal(s.elapsedMs, 5_000)

  assert.equal(ctl.act({ act: 'resume' }).changed, true)
  c.advance(2_000)
  s = ctl.snapshot()
  assert.equal(s.paused, null)
  assert.equal(s.running, true)
  assert.equal(s.elapsedMs, 7_000)
  assert.equal(ctl.pausedTab(), null)
  assert.equal(ctl.act({ act: 'resume' }).changed, false, 'resume when not paused does nothing')
})

test('no pause for a game not started, over, or a transition seen before the game started', () => {
  const c = clock()
  const ctl = createController({ now: c.now, rng: () => 0.5, size: 'small' })
  ctl.sessions([tab('t1', 'working')])
  assert.equal(ctl.sessions([tab('t1', 'waiting')]), false, 'ready game: no pause')
  assert.equal(ctl.snapshot().paused, null)
  ctl.act({ act: 'open', i: 40 })
  // The tab is still waiting: a state, not a transition seen while playing.
  assert.equal(ctl.sessions([tab('t1', 'waiting')]), false)
  assert.equal(ctl.snapshot().paused, null)

  // Over: lose on purpose by opening every cell until a mine goes.
  for (let i = 0; i < 81 && ctl.snapshot().status === 'play'; i++) ctl.act({ act: 'open', i })
  assert.notEqual(ctl.snapshot().status, 'play')
  ctl.sessions([tab('t1', 'working')])
  assert.equal(ctl.sessions([tab('t1', 'waiting')]), false, 'over: no pause')
  assert.equal(ctl.snapshot().paused, null)
})

test('several tabs: the pause names the latest one to become ready', () => {
  const { ctl } = playing()
  ctl.sessions([tab('a', 'working', { name: 'Alpha' }), tab('b', 'working', { name: 'Beta' })])
  ctl.sessions([tab('a', 'waiting', { name: 'Alpha' }), tab('b', 'working', { name: 'Beta' })])
  assert.equal(ctl.pausedTab(), 'a')
  assert.equal(ctl.sessions([tab('a', 'waiting', { name: 'Alpha' }), tab('b', 'waiting', { name: 'Beta' })]), true)
  assert.equal(ctl.pausedTab(), 'b')
  assert.deepEqual(ctl.snapshot().paused, { name: 'Beta' })
  assert.equal(ctl.snapshot().running, false, 'still paused')
})

test('New game while paused ends the pause; a new size is taken, junk sizes refused', () => {
  const { ctl } = playing()
  ctl.sessions([tab('t', 'working')])
  ctl.sessions([tab('t', 'waiting')])
  assert.equal(ctl.act({ act: 'new', size: 'nope' }).changed, false)
  assert.equal(ctl.act({ act: 'new', size: 'small' }).changed, true)
  const s = ctl.snapshot()
  assert.equal(s.paused, null)
  assert.equal(s.status, 'ready')
  assert.equal(s.size, 'small')
  assert.equal(s.cells, 'h'.repeat(81))
  assert.equal(s.elapsedMs, 0)
  assert.equal(ctl.act({ act: 'new' }).changed, true, 'no size keeps the size')
  assert.equal(ctl.snapshot().size, 'small')
})

// With an rng that always answers just under 1, `plant` takes the last free cell each time: after a first open at
// cell 0 of a small board, the 10 mines are cells 71-80. A flag on cell 40 stops the first open's flood fill short
// of a win; taking it away and opening 40 later wins, `ms` after the clock started.
function winner() {
  const c = clock()
  const ctl = createController({ now: c.now, rng: () => 0.999999, size: 'small' })
  const winOnce = (ms) => {
    ctl.act({ act: 'new' })
    ctl.act({ act: 'flag', i: 40 })
    ctl.act({ act: 'open', i: 0 })
    assert.equal(ctl.snapshot().status, 'play')
    c.advance(ms)
    ctl.act({ act: 'flag', i: 40 })
    const r = ctl.act({ act: 'open', i: 40 })
    assert.equal(ctl.snapshot().status, 'won')
    return r.record
  }
  return { ctl, winOnce }
}

test('a win stops the clock and records the best time per size in whole seconds', () => {
  const { ctl, winOnce } = winner()
  assert.deepEqual(winOnce(12_700), { size: 'small', seconds: 12 })
  const s = ctl.snapshot()
  assert.equal(s.running, false)
  assert.equal(s.elapsedMs, 12_700)
  assert.equal(s.record, true)
  assert.deepEqual(s.best, { small: 12, medium: null, large: null })
})

test('records: a faster win replaces the best, a slower or equal one does not', () => {
  const { ctl, winOnce } = winner()
  assert.deepEqual(winOnce(20_000), { size: 'small', seconds: 20 })
  assert.deepEqual(winOnce(9_000), { size: 'small', seconds: 9 })
  assert.equal(winOnce(15_000), undefined)
  assert.equal(ctl.snapshot().record, false)
  assert.equal(winOnce(9_400), undefined, 'same whole second')
  assert.equal(ctl.snapshot().best.small, 9)
})

test('stored best times: only valid numbers, and only lower than what is known', () => {
  const { ctl, winOnce } = winner()
  assert.equal(ctl.setBest({ small: 30, medium: 'x', large: -1 }), true)
  assert.deepEqual(ctl.snapshot().best, { small: 30, medium: null, large: null })
  assert.equal(ctl.setBest({ small: 40 }), false)
  assert.equal(ctl.setBest(null), false)
  assert.equal(winOnce(35_000), undefined, 'slower than the stored best')
  assert.deepEqual(winOnce(25_000), { size: 'small', seconds: 25 })
})

test('junk actions do nothing', () => {
  const { ctl } = playing()
  for (const m of [null, 1, 'open', {}, { act: 'boom' }, { act: '__proto__' }, { act: 'open', i: 'x' }]) {
    assert.equal(ctl.act(m).changed, false)
  }
})
