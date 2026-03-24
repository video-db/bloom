# Changelog

## [2.1.1] - 2026-03-25

### Library
- Delete recording with slide-out animation and 5s undo toast (deletes from both local DB and VideoDB)
- Keyboard navigation: Arrow keys to browse list, Delete/Backspace to remove recordings
- Auto-select next recording after deleting the active one
- Dark mode active row visibility improved
- Settings popover: replaced name input with read-only Shortcut and Collection info

### Floating Bar
- Show bar automatically when starting recording via Cmd+Shift+R
- Screen toggle swaps to `screen_off.png` icon when paused (matching mic/audio behavior)
- Updated source toggle icons

## [2.1.0] - 2026-03-23

### Theme System
- Full light/dark theme across all windows: floating bar, library, display picker, tooltips
- Semantic CSS variables for icons, spinners, badges, and accent colors
- Theme sync across windows — changing theme in library updates the floating bar instantly
- Light-themed tooltips, status badges, and settings popover
- Accent-colored active state for recording list items

### Library
- Dedicated "Bloom Recordings" collection — videos are now stored separately from the default collection
- Chat button restyled with VideoDB orange spectrum and pulsating background
- Settings popover with name editing, theme toggle, and Bloom branding
- Settings gear icon with rotation animation on hover
- Recording button with pulse animation (Material Symbols)
- Custom instant tooltips replacing native title attributes
- Consolidated to Material Symbols Rounded font across the library

### Floating Bar
- Unified close/library icon buttons with consistent hover behavior
- Proper stop recording button with orange accent styling
- Theme-aware grip dots, dividers, and icon tints
- Display picker with light theme support

## [2.0.0] - 2026-03-19

### Rebrand
- Renamed from "Async Recorder" to "Bloom" with new icon and assets

### New UI
- Floating bottom bar — always on top, click-through, draggable
- Display picker with multi-monitor support
- Source toggles (mic, audio, camera, screen) before and during recording
- Guided permissions flow with animated previews
- Context-aware system tray with recording state

### Library
- Redesigned with sidebar list + inline video player
- Search, sort, inline rename, download (video + transcript), and share link
- Chat with video — opens [VideoDB Chat](https://chat.videodb.io) for any recording
- Auto-sync pending recordings on open
- Per-user recording scoping

## [1.5.2] - 2026-03-17

- Compact main window with recording timer and quick rename
- Global shortcut (`Cmd+Shift+R`), system tray, and notifications
- Light/dark theme support
- Share links with subtitles
- Pre-built DMG downloads for macOS (arm64 + x64)

## [1.5.1] - 2025-02-24

- Removed Python backend — all logic runs inside Electron
- Polling fallback for reliable recording export
- Simplified startup to `npm start`

## [1.5.0] - 2025-02-18

- Updated to VideoDB SDK v0.2.0
- Added Windows support

## [1.0.0] - 2025-02-05

- Initial release — screen, mic, and system audio capture with camera overlay and in-app playback
