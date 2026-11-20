'use strict'
// Mines for cc-cockpit: a mine-finding puzzle in a panel, to play while Claude works. The game lives here in the
// host (lib/controller.js), one per project window: the panel page only draws what it is sent and posts the
// person's moves, so closing, hiding or reopening the panel never loses or unpauses a game.
//
// Harmless by design: no exec, no network, no secrets, no overlays, and nothing is ever typed into or sent to a
// session. Its only calls on Claude tabs are reading the window's list (ctx.sessions.list / onChange) for the
// pause and `ctx.sessions.focus` for the person's own Go to the tab click.

const { createController } = require('../lib/controller.js')
const { isSize, SIZE_IDS } = require('../lib/game.js')

const PANEL = 'mines'
const BEST_KEY = (size) => `best:${size}`
const SIZE_KEY = 'size'

let disposers = []

exports.activate = (ctx) => {
  // Best times and the last size are app-wide (every project window plays the same records); an app without
  // ctx.appStorage keeps them per project instead.
  const store = typeof ctx.appStorage === 'object' && ctx.appStorage !== null ? ctx.appStorage : ctx.storage
  const controller = createController()
  const push = () => ctx.panels.post(PANEL, { state: controller.snapshot() })
  /** To the one page that asked (`from.view`), or to every view when the app gave none. */
  const answer = (message, from) =>
    from && typeof from.view === 'string' ? ctx.panels.post(PANEL, message, { view: from.view }) : ctx.panels.post(PANEL, message)
  let picked = false // the person chose a size before the stored one was read: theirs wins

  async function load() {
    const best = {}
    for (const id of SIZE_IDS) best[id] = await store.get(BEST_KEY(id))
    controller.setBest(best)
    const size = await store.get(SIZE_KEY)
    if (!picked && isSize(size) && size !== controller.size() && controller.snapshot().status === 'ready') {
      controller.act({ act: 'new', size })
    }
  }
  // activate's return value is ignored, so messages can come before the store answered: each waits for it.
  const loaded = load().catch((err) => ctx.log.warn(`could not read the best times: ${err && err.message}`))

  /** A new best of this window. Another window may have stored a better one meanwhile: keep the lower. */
  async function saveRecord({ size, seconds }) {
    try {
      const stored = await store.get(BEST_KEY(size))
      if (typeof stored === 'number' && stored <= seconds) {
        if (controller.setBest({ [size]: stored })) push()
        return
      }
      await store.set(BEST_KEY(size), seconds)
    } catch (err) {
      ctx.log.warn(`could not save the best time: ${err && err.message}`)
    }
  }

  disposers.push(
    ctx.panels.onMessage(PANEL, async (msg, from) => {
      await loaded
      if (!msg || typeof msg !== 'object') return
      if (msg.hello) {
        answer({ state: controller.snapshot() }, from)
        return
      }
      if (msg.act === 'goto') {
        // Returned (awaited) from the listener, so the focus acts in the view the click came from.
        const tabId = controller.pausedTab()
        if (!tabId) return
        const ok = await ctx.sessions.focus(tabId).catch(() => false)
        if (!ok) answer({ notice: 'That Claude tab is closed.' }, from)
        return
      }
      if (msg.act === 'new' && isSize(msg.size)) {
        picked = true
        store.set(SIZE_KEY, msg.size).catch((err) => ctx.log.warn(`could not save the size: ${err && err.message}`))
      }
      const result = controller.act(msg)
      if (result.changed) push()
      if (result.record) await saveRecord(result.record)
    }),
  )

  // The pause: every change of this window's Claude tabs (statuses included) comes as the whole list. The first
  // list is read once at start so a tab already working then is known when it turns to waiting; an onChange that
  // came first is newer, so the start list is dropped then.
  let changeSeen = false
  disposers.push(
    ctx.sessions.onChange((list) => {
      changeSeen = true
      if (controller.sessions(list)) push()
    }),
  )
  ctx.sessions
    .list()
    .then((list) => {
      if (!changeSeen) controller.sessions(list)
    })
    .catch((err) => ctx.log.warn(`could not list the Claude tabs: ${err && err.message}`))
}

exports.deactivate = () => {
  for (const dispose of disposers) {
    try {
      if (typeof dispose === 'function') dispose()
    } catch {
      // the host is stopping anyway
    }
  }
  disposers = []
}
