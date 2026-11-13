# Bloom source

This folder is the Bloom desktop recorder. `npm start` runs it with the real capture engine; `npm run sample` runs the same windows on the sample engine for design work. See `docs/runbook.md` for flags and checks.

## How it works

Every window reads one state object and sends named commands. Nothing in a window talks to capture or VideoDB directly.

```
renderer windows  ──command──▶  main process  ──command──▶  engine
       ▲                            │                         │
       └────────── state ◀──────────┴────────── state ◀───────┘
```

- **Engine** (`engine/`): the only part that knows about capture and VideoDB. It owns the state object. `engine/index.js` documents the surface every engine implements.
- **Main process** (`main/`): tray, windows, notifications, menu, shortcuts, preferences, and the validated bridge between renderers and the engine.
- **Renderers** (`ui/`): draw the state and send commands. They are context-isolated and sandboxed, and reach the main process only through `preload.js`.

## Layout

```
src/
  preload.js          the only bridge between a renderer and the main process
  main/               main process, one responsibility per file
    index.js          lifecycle and wiring
    flags.js          flags and paths
    prefs.js          saved preferences
    theme.js          forced or preferred theme, window backdrop colour
    state.js          state sent to every surface, preferences applied to the app
    tray.js           tray icon and title
    windows.js        panel, workspace and onboarding windows
    notifications.js  notifications and reminders
    menu.js           application menu
    shortcuts.js      global shortcuts
    ipc.js            messages from renderers
    clock.js          mm:ss formatting shared by the tray and notifications
  engine/
    index.js          the engine surface and factory
    videodb/          real state engine, SDK adapter, credentials, receipts and recording cache
    sample/           sample engine: records nothing; used by tests and for design work
  ui/
    connected.html    page for every window of the running app (?surface=panel|workspace|onboarding)
    connected/        the running app's views: onboarding, tray panel, main window, settings, player
    tokens.css, ui.css, panel.css, workspace.css
                      the approved design's tokens and styles, shared by both sets of views
    *.html, *.js      sample-engine views of the approved design, including surfaces not built yet
  assets/             tray icons, fonts, the mark
  tests/              state tests and the Electron walkthrough
```

## Conventions

- One responsibility per file, named for what it owns. If a file needs a table of contents, split it.
- State has one owner. Pass what a module needs into it; do not reach across files for shared variables.
- The main process and engine are CommonJS. Renderer code is ES modules with explicit imports, no globals.
- A renderer never trusts itself: every message is validated in the main process.
- Views are small functions that return markup for one state. Keep markup readable across lines.
- Styles use the tokens in `ui/tokens.css`. No colour or size literals that a token already covers.
- Comments say why, briefly. The what belongs in names.
- A release build has no sample data, no "preview" wording and no control that does nothing. Features that are not built are hidden through the engine's capabilities, not left as dead buttons.
- The interface follows the approved designs. Record a change to what a person sees in the [interface change log](https://github.com/Spext/architectures/blob/main/Products/Bloom/docs/trackers/ui-change-log.md) before making it, and never redesign a surface while wiring it to real data.
- Behaviour changes come with a test. Run the state tests and the walkthrough in both themes, then look at the screens.

The real integration uses the public Node SDK from GitHub branch release-0.3.3; the lockfile records its resolved revision. Read [the boundary reference](../docs/reference/videodb-integration.md) before changing the SDK adapter or recovery state. The sample engine and test fixtures never run in a packaged app.
