# The rebuilt Bloom app

This folder is the rebuilt Bloom desktop recorder. It replaces the app in `src/main`, `src/renderer` and `src/preload` at cutover. Run it with `npm run next`; see `docs/runbook.md` for flags and checks.

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
src/next/
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
    sample/           sample engine: records nothing; used by tests and for design work
  ui/
    shared/           tokens, base styles, controls, the Bloom mark and icons, DOM helpers
    panel/            the tray panel
    workspace/        the main window: recording browser, editor, player, versions, settings
    onboarding/       first run
  assets/             tray icons, fonts, the mark
  tests/              state tests and the Electron walkthrough
```

## Conventions

- One responsibility per file, named for what it owns. If a file needs a table of contents, split it.
- State has one owner. Pass what a module needs into it; do not reach across files for shared variables.
- The main process and engine are CommonJS. Renderer code is ES modules with explicit imports, no globals.
- A renderer never trusts itself: every message is validated in the main process.
- Views are small functions that return markup for one state. Keep markup readable across lines.
- Styles live beside the part they style and use the tokens in `ui/shared/tokens.css`. No colour or size literals that a token already covers.
- Comments say why, briefly. The what belongs in names.
- A release build has no sample data, no "preview" wording and no control that does nothing. Features that are not built are hidden through the engine's capabilities, not left as dead buttons.
- Behaviour changes come with a test. Run the state tests and the walkthrough in both themes, then look at the screens.
