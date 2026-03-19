# Changelog

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
