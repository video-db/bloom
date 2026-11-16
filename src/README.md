# Bloom source

This folder is the Bloom desktop recorder. `npm start` runs it. See `docs/runbook.md` for flags and checks.

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
    first-window.js   which window opens at launch
    access.js         when setup is complete and the recording controls are available
    notifications.js  notifications and reminders
    menu.js           application menu
    shortcuts.js      global shortcuts
    ipc.js            messages from renderers
    collection-menu.js  the menu on a collection in the sidebar
    downloads.js      saving a recording to a file the person chooses
    screen-preview.js the still of the screen shown in setup
    quit-guard.js     when quitting asks first, and how long it waits for the recorder
    floating.js       windows that float over the screen: the recording control and the camera picture
    float-placement.js  where the control may sit so it is not in the recording, and where the camera goes
    clock.js          mm:ss formatting shared by the tray and notifications
  engine/
    index.js          the engine surface and factory
    videodb/          real state engine, SDK adapter, credentials, receipts and recording cache
    sample/           sample engine: records nothing; backs the main-process tests
  ui/
    app.html          the one page; ?surface=panel|workspace|onboarding|control|camera says which window it is
    app.js            state in, markup out: which view shows, redraw, focus kept across redraws
    actions.js        every click, form and key, turned into an engine command or a view change
    shared/           tokens, base styles, DOM helpers, icons, the Bloom mark
    panel/            the tray panel: sources and their choosers, each recording state
    workspace/        the main window: title bar, sidebar of places (places.js), and one
                      view per page: home, recordings, search, and the recording page
                      (recording.js) with its player, timeline, summary, transcript,
                      Make panel (make.js) and versions (versions.js)
    control/          the floating recording control
    camera/           the floating camera picture
    settings/         the Settings view
    onboarding/       first run: Connect, Permissions, Ready
  assets/             tray icons, fonts, the mark
  tests/              unit tests, Electron walkthroughs, the fake service and recorder
```

## Conventions

- One responsibility per file, named for what it owns. If a file needs a table of contents, split it.
- State has one owner. Pass what a module needs into it; do not reach across files for shared variables.
- The main process and engine are CommonJS. Renderer code is ES modules with explicit imports, no globals. `ui/package.json` marks that folder as ES modules so its pure functions can be unit-tested from Node.
- A renderer never trusts itself: every message is validated in the main process.
- Views are small functions that return markup for one state. Keep markup readable across lines.
- Each surface has one stylesheet beside its views; shared controls live in `ui/shared/base.css`. Styles use the tokens in `ui/shared/tokens.css`. No colour or size literals that a token already covers.
- Comments say why, briefly. The what belongs in names.
- A release build has no sample data, no "preview" wording and no control that does nothing. Features that are not built are hidden through the engine's capabilities, not left as dead buttons.
- The interface follows the approved designs. Record a change to what a person sees in the [interface change log](https://github.com/Spext/architectures/blob/main/Products/Bloom/docs/trackers/ui-change-log.md) before making it, and never redesign a surface while wiring it to real data.
- Behaviour changes come with a test. Run the unit tests and the walkthroughs in both themes, then look at the screens.
- A refactor that must not change how anything looks is checked, not eyeballed: run the walkthroughs with `BLOOM_STYLE_SNAPSHOT=1` before and after and compare with `src/tests/helpers/compare-styles.cjs`.

The real integration uses the public Node SDK, pinned in `package.json` to one commit on its release-0.3.3 branch. Read [the boundary reference](../docs/reference/videodb-integration.md) before changing the SDK adapter or recovery state. Test fixtures never run in a packaged app.
