# Build, install, verify and rollback

## Prerequisites

Use Node.js 18+ and npm. Recording requires a VideoDB API key and network access. macOS packaging uses the Apple signing tools invoked by `build/afterPack.js`.

## Run from source

```bash
npm ci
npm start
```

`npm start` runs Bloom with the real engine against the dev API; `npm start -- --production` selects production, which a packaged app always uses. First launch opens setup: use **Create a VideoDB account** to open the VideoDB console if you need a key, paste the key, then grant screen recording (which also covers system audio) and, optionally, the microphone. The key is validated and saved locally without Keychain prompts. Updating from encrypted storage requires entering the key once; see the storage details in the configuration reference. Flags and file locations are in the [configuration reference](reference/configuration.md).

Bloom remains in the macOS Dock while it is running. The tray icon appears only after sign-in, required permissions and setup completion. Until then, the recording shortcut opens setup, and the Recordings and Settings menu actions are unavailable. Signing out removes the tray, closes the main window and returns to setup. Active capture controls remain available to stop or recover an existing recording.

Bloom refreshes available displays and audio devices after a permission grant and whenever the tray panel opens. With more than one display, use the arrow beside the screen icon to choose one; with one display, it is selected automatically. If devices were connected or removed, close and reopen the tray to refresh the choices.

Start recording only after choosing the intended display or window and audio. Nothing captures automatically. Audio turned off in the tray is omitted from the recording. On Stop the tray shows the recording as Processing and Start is available again at once; when processing ends the recording is ready, then verify playback and the copied link. Transcript readiness is separate. A recording whose processing failed shows under Needs recovery with Recover, and does not block recording or quitting. New recordings are transcribed once processed when “Transcribe new recordings” is enabled (on by default); this can spend credits. The summary request also suggests a short content-based name for date-named Bloom recordings; custom names are kept. Recordings without usable transcript content keep their date names. Existing missing transcripts can be prepared with Add. After an accepted request, Try again reads its result without submitting another indexing request. Downloads use a save dialog. Rename and delete reach VideoDB; delete asks first and has no Undo.

A recording's file stays on the Mac until the recording is playable in VideoDB, and is then deleted by Bloom; use Download to keep a copy. A recording still waiting, or needing recovery, keeps its file and is found again at the next launch for the account that made it. There is no server-recording fallback. A forced kill while the file is still being written is not guaranteed recoverable.

## Automated checks

Run `npm test` for the state, engine, recorder-adapter and service tests. They use controlled Electron objects and a fake SDK: no network requests, no capture. Native notification delivery still needs an installed platform check.

With Playwright available, run the Electron walkthroughs one at a time (the app enforces one instance), each with `light` and `dark`:

| Command | Covers |
|---|---|
| `node src/tests/app-ui.cjs light` | The tray panel through every recording state, the main window (the recording page in Watch and Make, making a version, playing, copying and removing it) and Settings, with a fake recorder and a fake editor |
| `node src/tests/window-ui.cjs light` | The floating camera (drawn without opening the camera), then recording a single window: named, switched, hidden and shown, the floating control, paused, stopped |
| `node src/tests/quit-ui.cjs` | Quitting while a recording is being processed exits with no question |
| `node src/tests/onboarding-ui.cjs light` | First run with a fake service and recorder: key check, automatic advance, recorder failure, reopen, optional microphone, hand-off to the menu bar |

On macOS, `node src/tests/dock-ui.cjs` checks native Dock visibility through tray creation/show/hide, workspace/setup and window closure, plus preservation of accessory mode for background automation. It uses isolated blank windows without accounts or capture.

The app and onboarding walkthroughs run the real engine against a fake service and recorder (`--fixture`). Neither contacts VideoDB, looks at the screen or opens the microphone, and the fixture mode is ignored by packaged builds. Set `BLOOM_ELECTRON_PATH` and `BLOOM_PLAYWRIGHT_MODULE` if the tools are not installed in this checkout. Screenshots are saved under `.context/` (override with `BLOOM_UI_EVIDENCE`); look at them after a change to what a person sees.

### The real recorder

`node src/tests/recorder-check.cjs` checks what a fake recorder cannot: it opens two test windows that show the time as coloured columns, records them with the real recorder in standalone mode, and reads the time back out of each frame. It reports how soon after Start the first frame is from, whether a paused stretch stays in the file as a held picture or is cut out (and so whether the pause positions Bloom stores match the file), that the window list has the test windows, that switching and hiding a window show in the file, that a window lying on top of the recorded one is not in a window recording, and whether the recorder's display ids match the system's. Add `--display` to also record the main display for three seconds (everything on it), and `--keep` to keep the files.

It needs the Mac unlocked, Screen Recording allowed for the terminal, Bloom quit (one recorder runs at a time) and ffmpeg. Nothing is sent anywhere and the files are deleted at the end. A locked Mac offers no displays, so the check refuses to run on one. It exits 0 when every check passes, 1 when one fails and 2 when it could not run.

For a change that must not alter any screen, set `BLOOM_STYLE_SNAPSHOT=1` and a different `BLOOM_UI_EVIDENCE` folder before and after; each screenshot then also saves every element's computed style and box. `node src/tests/helpers/compare-styles.cjs <before> <after>` lists what differs.

## Build and install locally

1. Confirm the branch and `package.json` version. The current internal build is 2.3.12; main can have a different version.
2. Install dependencies with `npm ci`.
3. Build an unpacked app with `npm run pack`, or DMGs with `npm run dist`. The macOS installer configuration builds arm64 and x64. Output is under `dist/`, with DMGs named `bloom-<version>-mac-<arch>.dmg`.
4. Select the artifact matching the Mac architecture (`uname -m`: arm64 for Apple Silicon, x86_64 for Intel; x64 and AMD64 mean x86_64).
5. Quit Bloom through its tray menu. Move the existing `/Applications/Bloom.app` to Trash, then mount the local DMG and drag Bloom to Applications. Do not copy it over a running app.
6. If macOS blocks the locally built app, run `xattr -cr /Applications/Bloom.app`, then launch it. Local builds use ad-hoc signing and are not notarised releases.
7. Complete setup and permissions, then perform the checks below.

Data from releases up to 2.3.0 is not migrated; sign in again after installing. No data deletion is needed to replace the application bundle.

The packaging hook verifies the Electron executable, recorder and recorder library against each target architecture. Cross-building downloads the target recorder from the SDK’s pinned artifact URL, verifies its SHA-256 and replaces only the packaged copy before signing. ARM64 and x64 DMGs are separate artifacts; renaming a file does not change its version or architecture.

For an Apple Silicon internal-test installer only, run `npm run dist -- --mac dmg --arm64 --publish never`. Packaged builds select the production API and require a production account key; a development key will not work. This command creates a local installer and publishes nothing. The complete app bundle and its nested code are ad-hoc signed; it is not Developer ID signed or notarised. The build fails if the signature does not bind `com.videodb.bloom`, its Info.plist and resources. Verify an unpacked build with `node build/verify-mac-signature.js dist/mac-arm64/Bloom.app`. Ad-hoc signing does not guarantee permission continuity across rebuilt versions. Record the source commit and `shasum -a 256 dist/bloom-<version>-mac-arm64.dmg` with each test handoff, because local checkpoints can share a package version.

To retest macOS permissions, quit Bloom and run `tccutil reset ScreenCapture com.videodb.bloom` and `tccutil reset Microphone com.videodb.bloom`. This leaves credentials and recordings intact. Older helper-only-signed builds may also have generic executable entries in System Settings; remove those entries there before testing the corrected installer. Do not reset permissions for every app. Screen/system audio uses one Bloom entry; microphone has its own macOS permission.

For internal-test feedback, report issues in [the Bloom repository](https://github.com/video-db/bloom/issues) with the source commit, macOS version, Mac architecture, steps, expected result and actual result. Include redacted screenshots when useful; omit account keys, signed playback URLs and recordings. Record the result of each acceptance step below before treating the build as verified on a real account.

## Verify

Use `node --check <file>` for main-process, engine, preload and build scripts (CommonJS), and `node --input-type=module --check < <file>` for scripts under `src/ui/` (browser ES modules). Then run the automated checks above.

On the actual target platform, with a test account and a screen you are content to record:

1. Launch and confirm setup appears on first run only, and the tray icon appears when setup completes.
2. Sign in with a valid API key; confirm an invalid key yields an actionable error in place.
3. Grant permissions, choose a display or a single window, and record a short sample with the microphone and system audio on. Check both are in the recording and that a source turned off is absent.
4. Pause and resume, add a mark, then Stop. Wait through saving and confirm the tray shows the finished recording.
5. Turn the camera on from the tray: macOS asks once, then a round picture appears bottom left. Drag it, change its size, record the display and confirm the picture is in the recording; record a single window and confirm it is not.
6. Open the main window: check that the video plays and keeps playing when you change tab, that the timeline's chapters, marks and playhead follow it and that clicking or dragging the timeline moves the video, then check playback speed and full screen, the copied link, the transcript for a sample with speech, rename, download and delete.
7. Record a second time. Quit while it is still recording and confirm Bloom asks first; quit while it is being processed and confirm Bloom quits at once; reopen and confirm the recording becomes ready.
8. Open a recording with speech, switch to Make, and make one version in each title style with an end card. Confirm each plays in Watch, that Original is one click away and that Copy link copies what is playing.
9. Check both themes, native tooltips, both global shortcuts (start or stop, mark a moment) and notifications.
10. Repeat in a packaged build on each supported Mac architecture.

Redact keys, tokens and recording URLs before sharing any diagnostic output.

## Publish an update

A packaged Bloom checks `https://artifacts.videodb.io/bloom/latest-mac.json` three minutes after launch and then every four hours. When the feed names a newer version and its signature verifies, Bloom downloads that version's zip in the background, checks it, and puts it in place when Bloom is not in use (nothing recording, being sent or being made, no Bloom window open, the Mac untouched for a minute; or half an hour away with a window open), reopening to the menu bar. Otherwise it goes in when the person next quits Bloom. Nothing is shown and nothing waits on it.

1. Once, on the Mac that builds releases:
   - `node build/update-key.js` creates the key that signs the update feed, and prints the public key, which must match `src/main/update-key.js`.
   - `node build/signing-identity.js` creates Bloom's own code-signing certificate in a keychain of its own. Then trust it for code signing on that Mac, which asks for the Mac's password once: `security add-trusted-cert -r trustRoot -p codeSign -k ~/Library/Application\ Support/bloom-release/bloom-signing.keychain-db ~/Library/Application\ Support/bloom-release/bloom-signing.cert.pem` (export the certificate first with `security find-certificate -c "Bloom Release Signing" -p <keychain> > <cert.pem>`).
   - Both live in `~/Library/Application Support/bloom-release/` with their passwords. Keep a copy of that folder somewhere safe and never commit it. A lost update key means people install the next version by hand; a lost certificate means every Mac grants Bloom's permissions once more.
   - In [binary-publish](https://binary-publish.vercel.app), Bloom's settings declare both macOS DMGs and both macOS update zips as required, and hold the public update key; set these once.
2. Bump the version and build: `npm run dist`.
3. `node build/publish-update.js`. It fills `dist/release/` with exactly what the host holds: `v<version>/` with both DMGs, both update zips (made with `ditto`) and a `.sha256` beside each, and at the top `latest-mac.json` (the feed, signed, and checked against the key the app ships with) and `latest-version.txt` (what the install command reads).
4. Publish through [binary-publish](https://binary-publish.vercel.app) (VideoDB sign-in): Bloom → Publish new version, type the version, drop the four files from `dist/release/v<version>/` (both DMGs, both zips) and `dist/release/latest-mac.json`, Review, Publish. Skip the `.sha256` files and `latest-version.txt`; the tool writes them, checks the feed against the key registered in Bloom's settings, and moves `latest-version.txt` and `latest-mac.json` last. Publishing is the moment every running Bloom can see the update and the install command gives the new version.

Installed versions before 2.3.10 have no updater: install 2.3.10 by hand once. Bloom does not update itself from source, from a disk image, from a translocated copy (opened straight from Downloads without moving to Applications), or from a folder it cannot write to. Downloaded updates are kept in the `updates` folder of Bloom's data until they are in place.

Builds made on that Mac are signed with Bloom's certificate (the build log says "Signing with Bloom Release Signing"), so macOS keeps Bloom's permissions across updates. A build on a Mac without it is signed ad hoc, and macOS would forget Screen Recording at each update; Bloom then opens setup at the permissions step and says why. Never ship an ad hoc build after a certificate-signed one: the updater refuses it, and people would have to grant permissions again.

## Reset local state

1. Quit Bloom from its tray panel.
2. Remove the `bloom-next` folder under the application-support directory (see the [configuration reference](reference/configuration.md#files)).
3. Relaunch and complete setup again.

Reset removes the saved key, preferences and cached library metadata. It does not delete recordings from VideoDB. A recording that had not finished processing is forgotten by the reset: Bloom's list of such files is in the folder being removed, so its file is left in the recorder's folder and no longer shown.

## Rollback

Quit Bloom, remove the installed application bundle, and install the previously verified DMG. Recheck permissions and sign-in. Releases up to 2.3.0 keep their data in a different folder and do not share it with this app, so rolling back to one of them needs a fresh registration there.
