# Changelog

## Unreleased

## [2.3.6] - 2026-11-14

- A floating camera: the camera icon in the tray shows a round, mirrored picture of your camera on screen, bottom left. Drag it anywhere; three sizes appear under the pointer. It can be turned on or off while recording. It is part of a display recording because it is on that screen; it is not part of a single-window recording, and the tray says so.
- Muting a source from the floating control no longer races with Pause and Resume, a pause no longer asks again for a source that is already muted, and a mute that fails is said.
- A floating recording control: a small translucent capsule with Stop and the time, Pause, Mark, the microphone and system audio each muted on their own, and Hide window. It appears while a window is recorded, or on a display that is not the one being recorded, so it is never in the recording. It can be dragged and turned off in Settings.
- Record a single window: the chooser beside the screen icon lists open windows by app. While recording a window you can switch to another or hide it behind a plain card. A window that has closed is never replaced by the whole display.
- Recording uses the SDK's standalone mode: no session or token is needed to start, the recording is a file on this Mac, and Bloom sends it to VideoDB itself. An earlier recording keeps being processed while you record the next. Recording uses the default microphone, so the microphone chooser is gone.
- Quit: a second, older check could still ask "Bloom is still processing a recording" after the quiet quit and leave Bloom running; it now applies to the sample engine only.

## [2.3.5] - 2026-11-13

- An earlier recording never blocks the next one: Start is available as soon as a recording's file is on this Mac, including after a failed recording or a failed recovery. A recording still being processed is set aside while you record and continues afterwards.
- Bloom asks before quitting only while it is recording or still writing the file; otherwise it quits at once and continues processing on the next launch. Launch no longer waits for earlier recordings.
- Setup: the microphone row waits for macOS's answer and turns on as soon as access is given, instead of staying "Off" after access was granted. The line about where recordings go is removed from the Permissions step.
- Wording: recordings are "Processing" and then ready; a failed one "Needs recovery" with "Recover". "Upload" and "Retry" no longer appear.
- Setup: "Reopen Bloom" after granting screen recording restarts without the quit warning when nothing is being captured or finalised; a retained failed upload no longer blocks it.
- Search: a search with no matches shows "No moments found" instead of a connection error.

## [2.3.4] - 2026-11-13

### Rebuilt app
- Bloom is rebuilt: a menu-bar recorder with one tray panel for every recording state, a three-step setup, and a main window with a recording browser, transcript and player. The previous app's code is removed.
- Recording is local, with marks, pause and resume; each recording is finalised, uploaded and processed with durable recovery after a quit or lost connection.
- The API key is validated before saving locally; sign-out is available from the menu and Settings.
- Bundled HLS playback, confirmed rename, delete and download, a single-instance guard and a quit prompt while a recording is saving.
- The main window is an app with a sidebar: Home, Recordings and Search, the account's VideoDB collections (others open read-only), and the credit balance. One recording opens alone, with its transcript as paragraphs with times.
- A recording opens on its Summary: a few sentences, key points and action items, each with the time it comes from. New recordings are transcribed once uploaded (a setting, on by default).
- `npm start` runs the app; `npm test` runs the automated tests.

### Internal testing fixes
- Save the API key locally without Keychain prompts, remove encryption wording, and show actionable sign-in errors. Updating from encrypted storage requires entering the key once.
- Restore setup when reopening Bloom, refresh displays after permission changes, and retain the Dock icon.
- Sign the complete macOS app bundle as Bloom and verify its identity before packaging.
- Package separate Apple Silicon and Intel installers with matching native capture binaries.

### Removed
- The floating control bar, camera bubble, separate permission and display-picker windows, and the local SQLite database with its `sql.js`, `dotenv` and older `videodb` SDK dependencies.
- Data from earlier releases is not migrated; sign in again after updating.

### Documentation
- Centralised architecture, decisions and work tracking in architectures under Products/Bloom.
- Added configuration, local-install and verification instructions.
- Consolidated reset instructions, corrected source-backed feature/configuration descriptions and shortened the repository map.

### Repository
- Added shared ignore rules for local agent context, environment overrides, database sidecars, recordings and generated installers.

### Branding
- Aligned package license metadata with the MIT license file.

## [2.3.0] - 2026-04-06

### Audio
- Better audio input device support

### Library
- Updated VideoDB SDK to 0.2.6

## [2.2.0] - 2026-03-25

### Platform Support
- Windows support — recording, device selection, and permissions now work on Windows
- Windows installer (NSIS) for easy distribution

### Stability
- Improved capture process lifecycle to prevent orphaned processes
- Fixed recording failures caused by stale binary instances

### UI
- Native window controls on each platform

## [2.1.1] - 2026-03-25

### Library
- Delete recordings with slide-out animation and undo support
- Keyboard navigation — arrow keys to browse, Delete to remove
- Auto-select next recording after deletion
- Settings popover now shows recording shortcut and collection info

### Floating Bar
- Bar appears automatically when recording starts via keyboard shortcut
- Distinct on/off icons for screen toggle during recording
- Refreshed source toggle icons

## [2.1.0] - 2026-03-23

### Theme
- Full light and dark theme across all windows
- Theme syncs instantly between floating bar and library

### Library
- Dedicated "Bloom Recordings" collection for organized storage
- Settings popover with theme toggle and branding
- Chat button with VideoDB-styled design
- Custom tooltips and Material Symbols icon set

### Floating Bar
- Theme-aware controls, dividers, and icon tints
- Display picker with light theme support

## [2.0.0] - 2026-03-19

### Rebrand
- Bloom name, icon and branding refresh

### Floating Bar
- Always-on-top bottom bar with click-through and drag support
- Display picker with multi-monitor support
- Source toggles for mic, audio, camera, and screen
- Guided permissions flow with animated previews
- Context-aware system tray

### Library
- Sidebar list with inline video player
- Search, sort, rename, download, and share
- Chat with any recording via [VideoDB Chat](https://chat.videodb.io)
- Auto-sync pending recordings on open

## [1.5.2] - 2026-03-17

- Recording timer, global shortcut (Cmd+Shift+R), system tray, and notifications
- Light/dark theme support and share links with subtitles
- Pre-built DMG downloads for macOS

## [1.5.1] - 2025-02-24

- Removed Python backend — all logic runs inside Electron
- Simplified startup to `npm start`

## [1.5.0] - 2025-02-18

- Updated to VideoDB SDK v0.2.0
- Added Windows support

## [1.0.0] - 2025-02-05

- Initial release — screen, mic, and system audio capture with camera overlay and in-app playback
