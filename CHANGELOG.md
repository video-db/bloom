# Changelog

## [1.5.2] - 2026-03-16

- Restructured app from flat `frontend/` layout to modular `src/` architecture (main, renderer, preload)
- Fixed packaged DMG crash: capture binary now copied to writable `userData/bin/` with spawn redirect (`videodb-patch.js`)
- Added `afterPack.js` build hook for VideoDBCapture.app codesigning and Info.plist patching
- Added stale lock file cleanup on startup
- Updated VideoDB SDK to v0.2.2
- Updated README with Mermaid architecture diagram and new project structure
- Improved `.gitignore` for Electron app conventions

## [1.5.1] - 2025-02-24

- Removed Python backend — all server logic now runs inside Electron (Node.js)
- Replaced Express webhook + Cloudflare tunnel with WebSocket for capture events
- Removed `express`, `cors` dependencies (50 fewer packages)
- Added resilience: polling fallback if WebSocket misses events, orphan session sync on startup
- Updated VideoDB Node SDK to v0.2.1
- Simplified startup to single `npm start` command
- Added DMG build support for macOS
- Migrated to standalone repository

## [1.5.0] - 2025-02-18

- Updated to VideoDB SDK v0.2.0 (npm) and v0.4.0 (Python)
- Added Windows support
- Bug fixes

## [1.0.0] - 2025-02-05

Initial public release.

- Screen, microphone, and system audio capture
- Draggable camera bubble overlay
- Recording history with in-app playback
- Auto-indexing for searchable recordings
- Real-time event delivery via WebSocket
