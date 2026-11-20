'use strict'
// The Mines panel page. It draws the state the host sends and posts the person's moves; the game, its clock and
// the Claude pause live in the host (lib/controller.js), so this page can be closed or hidden at any time. Only
// the keyboard cursor and the Open/Flag switch are the page's own.
;(function () {
  const V = globalThis.MinesView
  const $ = (id) => document.getElementById(id)
  const board = $('board')
  const cover = $('cover')

  let state = null
  let shownAt = 0 // performance.now() when `state` came, for the running clock
  let tick = 0
  let flagMode = false
  let notice = '' // a refusal for this page (Go to the tab on a closed tab), until the next state
  const kb = { x: 0, y: 0 }

  const post = (message) => ccPanel.post(message)

  // ---- drawing ----

  function elapsedSeconds() {
    if (!state) return 0
    const ms = state.elapsedMs + (state.running ? performance.now() - shownAt : 0)
    return Math.floor(ms / 1000)
  }

  function drawClock() {
    $('time').textContent = String(elapsedSeconds())
  }

  function drawSizes() {
    const select = $('size')
    if (select.options.length !== state.sizes.length) {
      select.textContent = ''
      for (const s of state.sizes) {
        const o = document.createElement('option')
        o.value = s.id
        o.textContent = V.sizeLabel(s)
        select.append(o)
      }
    }
    select.value = state.size
  }

  // The cells are kept and updated in place, never rebuilt on a state or a focus change: a click whose element
  // went between its mousedown and mouseup (the board taking focus redrew it) would land on the board, not a cell.
  let cellEls = []
  let shown = [] // the character each element draws now

  function drawBoard() {
    if (cellEls.length !== state.cells.length) {
      board.textContent = ''
      board.style.gridTemplateColumns = `repeat(${state.w}, 1fr)`
      board.style.setProperty('--cols', String(state.w))
      board.style.setProperty('--rows', String(state.h))
      cellEls = []
      shown = []
      for (let i = 0; i < state.cells.length; i++) {
        const el = document.createElement('div')
        el.dataset.i = String(i)
        board.append(el)
        cellEls.push(el)
        shown.push(null)
      }
    }
    for (let i = 0; i < state.cells.length; i++) {
      const ch = state.cells[i]
      if (shown[i] === ch) continue
      const c = V.cell(ch)
      cellEls[i].className = c.cls
      // Only fixed markup and digits (view.js), never text from the state.
      cellEls[i].innerHTML = c.html
      cellEls[i].setAttribute('aria-label', c.label)
      shown[i] = ch
    }
    drawCursor()
  }

  /** The keyboard cursor: an outline on one cell while the board has focus. */
  function drawCursor() {
    if (!state) return
    kb.x = Math.min(kb.x, state.w - 1)
    kb.y = Math.min(kb.y, state.h - 1)
    const cur = document.activeElement === board ? kb.y * state.w + kb.x : -1
    cellEls.forEach((el, i) => el.classList.toggle('kb', i === cur))
  }

  function drawCover() {
    const spec = V.coverFor(state)
    const hadFocus = document.activeElement === board || cover.contains(document.activeElement)
    if (!spec) {
      if (!cover.hidden && cover.contains(document.activeElement)) board.focus()
      cover.hidden = true
      cover.textContent = ''
      return
    }
    cover.className = `cover ${spec.kind}`
    cover.textContent = ''
    const big = document.createElement('div')
    big.className = 'big'
    if (spec.dot) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      big.append(dot)
    }
    big.append(spec.title)
    cover.append(big)
    if (spec.text) {
      const what = document.createElement('div')
      what.className = 'what'
      what.textContent = spec.text
      cover.append(what)
    }
    if (notice) {
      const line = document.createElement('div')
      line.className = 'cc-error-line'
      line.textContent = notice
      cover.append(line)
    }
    const row = document.createElement('div')
    row.className = 'buttons'
    let primary = null
    for (const b of spec.buttons) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = b.label
      btn.dataset.act = b.act
      if (b.primary) {
        btn.className = 'cc-primary'
        primary = btn
      }
      row.append(btn)
    }
    cover.append(row)
    cover.hidden = false
    // Someone playing by keyboard keeps going from the cover's main button; a page without focus never takes it.
    if (hadFocus && primary) primary.focus()
  }

  function draw() {
    if (!state) return
    $('loading').hidden = true
    drawSizes()
    $('left').textContent = String(state.minesLeft)
    drawClock()
    drawBoard()
    drawCover()
    const best = state.best && state.best[state.size]
    $('best').textContent = V.seconds(best)
    clearInterval(tick)
    tick = state.running ? setInterval(drawClock, 250) : 0
  }

  // ---- the host ----

  ccPanel.onMessage((message) => {
    if (!message || typeof message !== 'object') return
    if (message.state) {
      state = message.state
      shownAt = performance.now()
      notice = ''
      draw()
    } else if (typeof message.notice === 'string') {
      notice = message.notice
      drawCover()
    }
  })
  // Each new connection (the first one, a host restart) asks for the whole state; an app without onConnect gets
  // one ask, queued until the connection is up.
  if (typeof ccPanel.onConnect === 'function') ccPanel.onConnect(() => post({ hello: 1 }))
  else post({ hello: 1 })

  // ---- input ----

  const playing = () => state && !state.paused && (state.status === 'ready' || state.status === 'play')
  const index = () => kb.y * state.w + kb.x

  function click(i, flagIt) {
    if (!playing()) return
    const open = state.cells[i] !== 'h' && state.cells[i] !== 'f'
    post({ act: flagIt && !open ? 'flag' : 'open', i })
  }

  board.addEventListener('click', (e) => {
    const el = e.target.closest('.c')
    if (!el || !state) return
    const i = Number(el.dataset.i)
    kb.x = i % state.w
    kb.y = Math.floor(i / state.w)
    drawCursor()
    click(i, flagMode)
  })
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const el = e.target.closest('.c')
    if (el && playing()) post({ act: 'flag', i: Number(el.dataset.i) })
  })
  // Keys only while the board has focus, and only these; everything else goes on to the app.
  board.addEventListener('keydown', (e) => {
    if (!state || e.ctrlKey || e.metaKey || e.altKey) return
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (move) {
      kb.x = Math.min(state.w - 1, Math.max(0, kb.x + move[0]))
      kb.y = Math.min(state.h - 1, Math.max(0, kb.y + move[1]))
      drawCursor()
    } else if (e.key === ' ' || e.key === 'Enter') {
      click(index(), false)
    } else if (e.key === 'f' || e.key === 'F') {
      if (playing()) post({ act: 'flag', i: index() })
    } else if (e.key === 'n' || e.key === 'N') {
      post({ act: 'new' })
    } else {
      return
    }
    e.preventDefault()
  })
  board.addEventListener('focus', drawCursor)
  board.addEventListener('blur', drawCursor)

  cover.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]')
    if (btn) post({ act: btn.dataset.act })
  })

  function setMode(flag) {
    flagMode = flag
    $('mOpen').setAttribute('aria-pressed', String(!flag))
    $('mFlag').setAttribute('aria-pressed', String(flag))
  }
  $('mOpen').addEventListener('click', () => setMode(false))
  $('mFlag').addEventListener('click', () => setMode(true))
  $('new').addEventListener('click', () => post({ act: 'new' }))
  $('size').addEventListener('change', (e) => post({ act: 'new', size: e.target.value }))
})()
