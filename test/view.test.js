'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const V = require('../panels/view.js')

test('cells: numbers are their digit, the colour class only helps; hidden, flags and mines are shapes', () => {
  for (const d of '12345678') {
    const c = V.cell(d)
    assert.equal(c.html, d)
    assert.equal(c.cls, `c open n${d}`)
  }
  assert.deepEqual(V.cell('0'), { cls: 'c open', html: '', label: 'empty' })
  assert.equal(V.cell('h').cls, 'c')
  assert.match(V.cell('f').html, /<svg/)
  assert.match(V.cell('x').cls, /wrong/)
  assert.match(V.cell('b').cls, /boom/)
  assert.match(V.cell('m').html, /<circle/)
  assert.equal(V.cell('<img>').html, '', 'anything unknown draws as hidden')
})

test('covers: paused names the tab and offers Resume (primary) and Go to the tab', () => {
  const c = V.coverFor({ status: 'play', paused: { name: 'fix the scroll test' } })
  assert.equal(c.kind, 'paused')
  assert.equal(c.title, 'Claude is ready')
  assert.equal(c.text, '“fix the scroll test” is waiting for you.')
  assert.deepEqual(c.buttons.map((b) => [b.act, b.label, b.primary]), [
    ['resume', 'Resume game', true],
    ['goto', 'Go to the tab', false],
  ])
})

test('covers: lost, won with and without a record, none while playing', () => {
  assert.deepEqual(V.coverFor({ status: 'lost' }), { kind: 'lost', title: 'Boom.', buttons: [{ act: 'new', label: 'New game', primary: true }] })
  assert.equal(V.coverFor({ status: 'won', elapsedMs: 41_900, record: true }).title, 'Cleared in 41 s · new best')
  assert.equal(V.coverFor({ status: 'won', elapsedMs: 41_900, record: false }).title, 'Cleared in 41 s')
  assert.equal(V.coverFor({ status: 'won', elapsedMs: 1 }).buttons[0].label, 'Play again')
  assert.equal(V.coverFor({ status: 'play', paused: null }), null)
  assert.equal(V.coverFor({ status: 'ready', paused: null }), null)
  assert.equal(V.coverFor(null), null)
})

test('labels: seconds and the size picker', () => {
  assert.equal(V.seconds(12), '12 s')
  assert.equal(V.seconds(null), '—')
  assert.equal(V.sizeLabel({ label: 'Medium', w: 12, h: 12, mines: 22 }), 'Medium · 12×12 · 22')
})
