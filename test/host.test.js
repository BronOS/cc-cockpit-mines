'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fakeCtx } = require('./fake-ctx.js')

const root = path.join(__dirname, '..')
const host = require('../dist/host.js')

const tab = (tabId, status, extra = {}) => ({ tabId, status, cwd: '/proj', notes: [], files: [], ...extra })
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function started(opts) {
  const f = fakeCtx(opts)
  host.activate(f.ctx)
  await settle()
  return f
}

test.afterEach(() => host.deactivate())

test('hello is answered with the state, to the view that asked only', async () => {
  const f = await started()
  await f.send({ hello: 1 }, 'web:3')
  const last = f.posts.at(-1)
  assert.deepEqual(last.options, { view: 'web:3' })
  assert.equal(last.message.state.status, 'ready')
  assert.equal(last.message.state.size, 'medium')
  assert.equal(last.message.state.cells, 'h'.repeat(144))
})

test('moves go to every view; the clock and the board live in the host', async () => {
  const f = await started()
  await f.send({ act: 'open', i: 0 })
  const last = f.posts.at(-1)
  assert.equal(last.options, undefined, 'state changes go to every view')
  assert.equal(last.message.state.status === 'play' || last.message.state.status === 'won', true)
  assert.equal(last.message.state.running, last.message.state.status === 'play')
})

test('pause: a working tab of the window turning waiting while playing pauses and names it; Go to the tab focuses it', async () => {
  const f = await started({ sessions: [tab('t1', 'working', { title: 'Fix the scroll test' })] })
  await f.send({ act: 'new', size: 'large' })
  await f.send({ act: 'open', i: 0 })
  assert.equal(f.lastState().status, 'play')
  f.setSessions([tab('t1', 'waiting', { title: 'Fix the scroll test' })])
  const s = f.lastState()
  assert.deepEqual(s.paused, { name: 'Fix the scroll test' })
  assert.equal(s.running, false)

  // Moves are refused while paused: nothing is posted.
  const n = f.posts.length
  await f.send({ act: 'open', i: 255 })
  assert.equal(f.posts.length, n)

  await f.send({ act: 'goto' }, 'web:1')
  assert.deepEqual(f.focused, ['t1'])
  assert.equal(f.posts.length, n, 'a focus that worked posts nothing')
  assert.equal(f.lastState().paused.name, 'Fix the scroll test', 'Go to the tab does not resume')

  await f.send({ act: 'resume' })
  assert.equal(f.lastState().paused, null)
  assert.equal(f.lastState().running, true)
})

test('the start list counts: a tab working before activation pauses when it turns waiting', async () => {
  const f = await started({ sessions: [tab('t1', 'working', { name: 'Docs' })] })
  await f.send({ act: 'new', size: 'large' })
  await f.send({ act: 'open', i: 0 })
  f.setSessions([tab('t1', 'waiting', { name: 'Docs' })])
  assert.deepEqual(f.lastState().paused, { name: 'Docs' })
})

test('no pause before the first open; Go to the tab on a closed tab tells only that view', async () => {
  const f = await started({ sessions: [tab('t1', 'working')] })
  f.setSessions([tab('t1', 'waiting')])
  await f.send({ hello: 1 })
  assert.equal(f.lastState().paused, null)

  await f.send({ act: 'new', size: 'large' })
  await f.send({ act: 'open', i: 0 })
  f.setSessions([tab('t1', 'working')])
  f.setSessions([tab('t1', 'waiting')])
  assert.ok(f.lastState().paused)
  f.setSessions([])
  await f.send({ act: 'goto' }, 'web:2')
  assert.deepEqual(f.posts.at(-1), { panelId: 'mines', message: { notice: 'That Claude tab is closed.' }, options: { view: 'web:2' } })
})

test('best times are kept app-wide per size; a better one stored by another window is kept', async () => {
  const f = await started()
  await f.ctx.appStorage.set('best:small', 7)
  host.deactivate()
  const g = fakeCtx()
  await g.ctx.appStorage.set('best:large', 99)
  await g.ctx.appStorage.set('size', 'large')
  host.activate(g.ctx)
  await g.send({ hello: 1 })
  const s = g.lastState()
  assert.equal(s.best.large, 99)
  assert.equal(s.size, 'large', 'the last size picked comes back')
  await g.send({ act: 'new', size: 'small' })
  assert.equal(await g.ctx.appStorage.get('size'), 'small')
})

test('without ctx.appStorage the records go to ctx.storage', async () => {
  const f = await started({ appStorage: false })
  await f.send({ act: 'new', size: 'small' })
  assert.equal(await f.ctx.storage.get('size'), 'small')
})

test('junk from the page is ignored', async () => {
  const f = await started()
  const n = f.posts.length
  for (const m of [null, 'x', 5, {}, { act: 'open', i: -4 }, { act: 'new', size: 'gigantic' }, { act: 'goto' }, { act: 'resume' }]) {
    await f.send(m)
  }
  assert.equal(f.posts.length, n)
})

test('the plugin is harmless: no exec, network, secrets, overlays or session writes in its code', () => {
  const files = ['dist/host.js', 'lib/game.js', 'lib/pause.js', 'lib/controller.js', 'panels/mines.js', 'panels/view.js']
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    for (const bad of [
      'ctx.exec',
      'ctx.processes',
      'ctx.secrets',
      'ctx.oauth',
      'ctx.overlay',
      'ctx.openExternal',
      'sessions.send',
      'sessions.open',
      'sessions.close',
      'sessions.rename',
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'require(\'node:child_process\')',
      'require(\'child_process\')',
      'localStorage',
      'alert(',
    ]) {
      assert.equal(text.includes(bad), false, `${file} uses ${bad}`)
    }
  }
})

test('the manifest: id, one right-zone panel with an svg icon, files present, no cli, skills or access', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'))
  assert.equal(m.id, 'bronos.mines')
  assert.equal(m.api, 1)
  assert.match(m.version, /^\d+\.\d+\.\d+$/)
  assert.deepEqual(Object.keys(m.contributes), ['panels'])
  assert.equal(m.access, undefined)
  assert.equal(m.services, undefined)
  const [p] = m.contributes.panels
  assert.equal(p.defaultZone, 'right')
  for (const file of [m.main, p.entry, p.icon]) assert.ok(fs.existsSync(path.join(root, file)), file)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.version, m.version)
})

test('the page: no inline script or handlers, relative URLs only, the SDK first', () => {
  const html = fs.readFileSync(path.join(root, 'panels/mines.html'), 'utf8')
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1], /src="/, 'every script has a src')
    assert.equal(m[2].trim(), '', 'no inline script')
  }
  assert.equal(/\son[a-z]+=/i.test(html), false, 'no inline event handlers')
  assert.equal(/(src|href)="\//.test(html), false, 'no root-absolute URL')
  assert.ok(html.indexOf('src="../__sdk/panel.js"') < html.indexOf('src="view.js"'))
  assert.ok(html.indexOf('src="view.js"') < html.indexOf('src="mines.js"'))
  assert.equal(/<form\b/i.test(html), false)
})

test('header: New game and Board size buttons, the board in play as its text', async () => {
  const f = await started()
  const h = f.headers.at(-1)
  assert.equal(h.meta, 'Medium · 12×12 · 22')
  assert.deepEqual(h.actions.map((a) => a.id), ['new', 'size'])
  assert.ok(fs.existsSync(path.join(root, h.actions[1].icon)), 'the size icon is a file of the plugin')

  await f.send({ act: 'new', size: 'wide' })
  assert.equal(f.headers.at(-1).meta, 'Wide · 30×16 · 99')

  await f.send({ act: 'open', i: 40 })
  assert.equal(f.lastState().status, 'play')
  await f.click('new')
  assert.equal(f.lastState().status, 'ready', 'New game starts over')
  assert.equal(f.lastState().size, 'wide', 'on the same board')

  await f.click('size')
  assert.deepEqual(f.posts.at(-1).message, { sizeMenu: true }, 'Board size opens the page menu')
})
