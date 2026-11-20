'use strict'
// Pure helpers of the Mines page: what a cell looks like and what a cover says, from the host's state. No DOM and
// no ccPanel, so `test/view.test.js` runs them under node; the page loads this file first as a classic script (the
// CSP allows only the plugin's own files) and reads `MinesView`.
;(function (root) {
  // Fixed markup only: nothing from the state (a tab's name above all) is ever put into HTML; covers are built
  // from `coverFor`'s plain strings with textContent.
  const FLAG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path class="cloth" d="M7 4h11l-3 4 3 4H7z"/></svg>'
  const MINE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" stroke="currentColor" stroke-width="2"/></svg>'

  /**
   * One cell of `state.cells` (game.view: `h` hidden, `f` flag, `x` wrong flag, `0`-`8` open, `m` mine, `b` the
   * mine that went off) as `{ cls, html, label }`. A number is its digit; the `nN` class only colours it.
   */
  function cell(ch) {
    if (ch === 'f') return { cls: 'c', html: FLAG, label: 'flag' }
    if (ch === 'x') return { cls: 'c wrong', html: FLAG, label: 'flag, no mine there' }
    if (ch === 'm') return { cls: 'c open', html: MINE, label: 'mine' }
    if (ch === 'b') return { cls: 'c open boom', html: MINE, label: 'mine that went off' }
    if (ch >= '1' && ch <= '8') return { cls: `c open n${ch}`, html: ch, label: ch }
    if (ch === '0') return { cls: 'c open', html: '', label: 'empty' }
    return { cls: 'c', html: '', label: 'hidden' }
  }

  /** `12 s`, or a dash for no time. */
  const seconds = (s) => (typeof s === 'number' && Number.isFinite(s) ? `${Math.max(0, Math.floor(s))} s` : '—')

  /**
   * The cover over the board, or null for none: `{ kind, title, text?, buttons: [{ act, label, primary }] }`.
   * A pause wins over everything (it only happens in play); then a lost or won game.
   */
  function coverFor(state) {
    if (!state) return null
    if (state.paused) {
      return {
        kind: 'paused',
        dot: true,
        title: 'Claude is ready',
        text: `“${state.paused.name}” is waiting for you.`,
        buttons: [
          { act: 'resume', label: 'Resume game', primary: true },
          { act: 'goto', label: 'Go to the tab', primary: false },
        ],
      }
    }
    if (state.status === 'lost') {
      return { kind: 'lost', title: 'Boom.', buttons: [{ act: 'new', label: 'New game', primary: true }] }
    }
    if (state.status === 'won') {
      const time = Math.floor((state.elapsedMs || 0) / 1000)
      return {
        kind: 'won',
        title: `Cleared in ${time} s${state.record ? ' · new best' : ''}`,
        buttons: [{ act: 'new', label: 'Play again', primary: true }],
      }
    }
    return null
  }

  /** The size picker's line: `Medium · 12×12 · 22`. */
  const sizeLabel = (s) => `${s.label} · ${s.w}×${s.h} · ${s.mines}`

  const api = { cell, coverFor, seconds, sizeLabel }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MinesView = api
})(globalThis)
