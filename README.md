# Mines

A cc-cockpit plugin (`bronos.mines`): a mine-finding puzzle in a panel, to play while Claude works. When a Claude tab of
the window finishes its turn and waits for you, the game pauses and tells you which tab it is.

It is a harmless game: no commands, no settings, no network, no secrets, no overlays. It reads the window's Claude tab
statuses and names, and its one action on a tab is to show it when you click **Go to the tab**. It never types into or
sends anything to a session.

## Install

From a checkout: `ccc plugin link <path to this repo>`, then Allow it in the app window. The **Mines** panel opens in the
right zone (move it like any panel).

## How to play

Open every cell that holds no mine.

- Pick the board with the **Board size** button (the grid icon in the panel's title bar), which opens a menu: Small 9×9 with 10 mines, Medium 12×12 with 22, Large 16×16 with 40, Huge 24×24 with 99, Wide 30×16 with 99. Huge and Wide want a wide zone or a wider panel: cells never get smaller than 16 px, so in a narrow panel the board scrolls sideways. Picking one, or
  **New game** (the circular arrow next to it, or N), starts a new game. The title bar shows the board in play. The size you picked last comes back next time.
- Click opens a cell. The first click is always safe: neither it nor its neighbours hold a mine, so it opens an area.
- A number is how many of the 8 cells around it hold a mine. A cell with none opens its neighbours by itself.
- Right-click puts or takes away a flag. On a trackpad or a phone, switch **Open / Flag** to Flag: a click then flags.
- Click a number whose flags are all placed (as many flags around it as its number) to open its other neighbours. A
  wrong flag there means one of them is a mine, and it goes off.
- The bar shows the mines left (mines minus flags) and the time in seconds, counted from the first click.
- Opening a mine ends the game (**Boom.**): every mine is shown and a wrong flag is crossed out. Opening the last safe
  cell wins it, with your time and whether it is a new best.
- Keys work only after a click into the board (it has focus): arrows move the outlined cell, Space or Enter opens it, F
  flags it, N starts a new game. Other keys go on to the app.

Best times are kept per board size, for every project window, across restarts (whole seconds).

## The Claude pause

While a game is running (started and not over), a Claude tab of the same window that was **working** and becomes
**waiting for input** pauses it: the clock stops, the board takes no clicks, and a cover says **Claude is ready** with
the tab's name (the name you gave it, else Claude's topic for it). **Resume game** goes on where the clock stopped; **Go
to the tab** shows that tab and leaves the game paused for when you come back.

- Only a change seen while you play pauses: a tab that was already waiting, or one that finished before your first
  click or after the game ended, does not.
- With several tabs, the cover names the latest one to become ready.
- A tab that stops to ask for a permission (or a question) is not "ready" and does not pause the game.
- The game lives in the plugin's host, not in the panel page: a paused game stays paused, and a running one keeps its
  time, while the panel is hidden or closed. Every view of the window (the desktop and a web access browser) shows the
  same game.
- A restart of the plugin host (the app restarting, or a plugin being enabled, linked or updated in the project) ends
  the game in progress; best times are kept.

How it knows: `ctx.sessions.onChange` (the window's Claude tabs with their status, on every change) and one
`ctx.sessions.list()` at start; **Go to the tab** is `ctx.sessions.focus`.

## Development

Plain JavaScript, no build step: `dist/host.js` wires `lib/controller.js` (the game, its clock, the pause and the
records) to the plugin API; `lib/game.js` is the board's rules and `lib/pause.js` the working-to-waiting rule, both pure;
`panels/` is the page (`view.js` its pure helpers, `mines.js` the drawing and input).

`npm test` runs the `node:test` suites: the game rules, the pause rule with a fake clock, the host with a fake `ctx`, and
the page's helpers.

## License

MIT
