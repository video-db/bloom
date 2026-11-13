# Build, install, verify and rollback

## Prerequisites

Use Node.js 18+ and npm. Recording requires a VideoDB API key and network access. macOS packaging uses the Apple signing tools invoked by `build/afterPack.js`.

## Run from source

```bash
npm ci
npm start
```

Complete registration and grant screen recording, microphone and camera permissions for the features you use.

## Run the new interface preview

`npm run next` starts the new Bloom interface from `src/next/` as a separate entry beside the shipping app. It shows onboarding, the tray panel and a unified recording browser with Review/Edit modes on sample data. It records nothing, makes no network or VideoDB calls, and keeps its own user data in the `bloom-next` application-support folder, so it does not touch `bloom.db` or the shipping app's settings.

Pass `-- --skip-onboarding` to start at the tray panel, `-- --open-main` to open the main window, and `-- --keep-open` to stop the panel closing when it loses focus. The interface follows the system appearance; `-- --light` or `-- --dark` forces one. The native **Help → Preview Scenarios** menu offers missing permission, connection loss, meeting ended, stop failure, delayed upload and processing failure. Capture is supplied by `src/next/engine/`; the preview uses the sample engine. The connected entry below selects the real engine.

Open Settings with **Bloom → Settings…**, **⌘,** (Ctrl+, elsewhere), the gear at the bottom of the recording browser, or the gear in any tray state. `npm run next -- --skip-onboarding --open-preferences` opens that view directly. Preferences and onboarding completion persist in `bloom-next/prefs.json`; `--fresh` uses in-memory defaults for verification. Appearance changes in Settings override an initial `--light` or `--dark` preview flag.

Recording defaults apply to the next session. Login-at-startup is a saved choice only; the preview does not register itself with macOS. Permission grants and device choices are simulated. Account connection, actual video playback, cloud sharing, exports and generated media are unavailable. Sample recordings, saved drafts, named versions and output recipes live in memory until the app quits; they survive closing the main window. Text selection supports sample text cuts, undo and redo. Search can assemble and reorder matching moments into a named sample cut, with links back to the source recordings. Versions can be renamed and deleted independently. The Versions tab offers caption, translation/dubbing, clean-voice, music, vertical and short-output recipes; saving a recipe starts no job and spends no credits. Natural-language edit requests can be saved as short-version recipes. These controls do not process video or estimate timing changes.

Run `node --test src/next/tests/state.test.js` for persistence failures, capture transitions, immutable versions/recipes, input validation, retry/trim, source overrides and window/notification lifecycle. The lifecycle tests use controlled Electron objects; native notification delivery still needs an installed platform check.

With Electron and Playwright available, run `node src/next/tests/ui.cjs light` and `node src/next/tests/ui.cjs dark`. Set `BLOOM_ELECTRON_PATH` and `BLOOM_PLAYWRIGHT_MODULE` to external tool paths if they are not installed in this checkout. The harness saves evidence under `.context/ui-completion` (override with `BLOOM_UI_EVIDENCE`) and explicitly sets and verifies the renderer color scheme because Playwright otherwise forces light media independently of Electron's native theme. It exercises the workspace, search cuts, six output recipes, edit history, Settings focus, processing retry, record management, minimum window size, display picker and long recording marks.

For manual review, check 1180×760 and 960×620, light and dark: title/Start are both 32 px; capture source targets are 36 px; display selection is reachable by keyboard; source off/on/paused states are distinct; Stop stays visible with long notes; mode and tab changes preserve focus; empty and failed states provide recovery; closing/reopening the main window retains saved versions. Check onboarding permissions, paused/interrupted test recovery, and failed preference saves. Native tray placement, vibrancy, global shortcuts and notification appearance/actions still require an eyes-on platform check.

## Run the rebuilt app with VideoDB

Run `npm ci`, then `npm run next:connected`. This selects the real engine and connected onboarding/tray/library/settings views. Use **Create a VideoDB account** on the connection screen to open the VideoDB console in your browser if you need an account or API key. Supply the key through the password field; it is validated and encrypted with Electron safeStorage. It is not read from the old database. The command defaults to the dev API (`-- --production` selects production); the packaged rebuilt entry explicitly selects production. It uses the same origin for the connection, recorder, tokens and recovery. The rebuilt SDK dependency is named videodb-capture and uses GitHub branch release-0.3.3, with the resolved revision in the lockfile. The existing app keeps its own videodb dependency until cutover.

The tray icon appears only after sign-in, required permissions and setup completion. Until then, the recording shortcut opens setup and recording, library and Settings menu actions are unavailable. Signing out removes the tray, closes the workspace and returns to setup. Active capture controls remain available to stop or recover an existing recording.

Start recording only after choosing the intended screen/audio and granting the actual OS permissions. Nothing captures automatically. Screen and system audio share the macOS screen permission; microphone permission is separate. Audio disabled in the tray is omitted from start. On Stop, wait through local finalization and upload/ingestion, then verify playback and the copied link; transcript readiness is separate. Preparing a missing transcript is an explicit action that can spend credits. Downloads use a save dialog and retain a temporary file only until transfer succeeds or fails. Rename/delete reach VideoDB; delete has confirmation and no fake Undo.

Preferences remain in bloom-next/prefs.json. The connected engine stores encrypted credentials, operation receipts and library metadata under bloom-next/videodb-dev/ (videodb-prod/ when composed with the production API). The native recorder owns local MP4s and relay receipts. Complete native jobs are rediscovered on connection; jobs are authorized against their original session owner before a fresh token is issued. The recorder deletes its media after confirmed ingestion, so use Download to keep a permanent copy. No server-recording fallback is available. A forced kill during unfinished MP4 writing is not guaranteed recoverable.

Run `node --test src/next/tests/state.test.js src/next/tests/access-and-uploads.test.js src/next/tests/videodb-service.test.js src/next/tests/videodb-engine.test.js src/next/tests/videodb-recorder.test.js` for offline behavior checks. With Playwright available, `node src/next/tests/connected-ui.cjs light` and `dark` use an explicitly gated development fixture, not a real recorder; evidence is under .context/connected-ui. The fixture mode is disabled for packaged builds. Run Electron walkthroughs sequentially because the app enforces one instance. The UI preview checks above continue to test the sample design path independently.

For real acceptance, use the owner-approved screen and a test account: verify both selected audio sources and their exclusion, pause alignment, a second recording, token renewal, network loss, pending-job recovery, actual link playback/transcript, rename/delete and download. Confirm graceful quit at each save stage. Perform the same checks in a packaged build on supported Mac architectures. The root package still launches the existing app; switching that entry and removing the old code is the separate cutover step. See the [boundary reference](reference/videodb-integration.md) for module/API contracts.

## Build and install locally

1. Confirm the branch and `package.json` version. This documentation starts from the v2.3.0 release source; main can have a different version.
2. Install dependencies with `npm ci`.
3. Build an unpacked app with `npm run pack`, or DMGs with `npm run dist`. The macOS installer configuration builds arm64 and x64. Output is under `dist/`, with DMGs named `bloom-<version>-<arch>.dmg`.
4. Select the artifact matching the Mac architecture (`uname -m`: arm64 for Apple Silicon, x86_64 for Intel).
5. Quit Bloom through its tray menu. Move the existing `/Applications/Bloom.app` to Trash, then mount the local DMG and drag Bloom to Applications. Do not copy it over a running app.
6. If macOS blocks the locally built app, run `xattr -cr /Applications/Bloom.app`, then launch it. Local builds use ad-hoc signing and are not notarised releases.
7. Complete registration and permissions, then perform the checks below.

The database name is `bloom.db`. Existing local databases are not migrated. No userData deletion is needed to replace the application bundle.

## Verify

| Source | Syntax check |
|---|---|
| Main, preload and build scripts (CommonJS) | `node --check <file>` |
| Renderer scripts with import/export (browser ES modules) | `node --input-type=module --check < <file>` |

No automated test or lint command is declared in `package.json`.

On the actual target platform:

1. Launch and confirm Bloom branding, onboarding and a usable tray menu.
2. Verify both dark and light themes in the floating controls and library.
3. Register with a valid API key; confirm an invalid key yields an actionable error.
4. Grant permissions, select a display and microphone, and record a short sample. Stop and wait for export.
5. Open the library and check playback. For a sample with speech, check transcript/subtitled playback after processing.
6. Check rename, share, download and pending-session synchronisation.
7. Quit and reopen. Confirm the new library and selected user persist.

Check `app.log` in the userData directory when diagnosing failures. Redact keys, tokens and recording URLs before sharing logs.

## Reset local state

1. Quit Bloom through its tray menu.
2. Find its userData directory from the database/config paths in `app.log`; development commonly uses `bloom` and installed builds can use `Bloom` under macOS Application Support.
3. Remove `bloom.db` and `config.json` from that directory.
4. Relaunch and register again.

Reset removes local accounts, library metadata and saved settings. It does not delete recordings from VideoDB.

## Rollback

Quit Bloom, remove the installed application bundle, and install the previously verified DMG. Recheck permissions and registration. There is no automatic database migration or rollback in this naming cleanup; use a fresh registration if the older build expects a different database.
