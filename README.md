<!-- PROJECT SHIELDS -->
[![Electron][electron-shield]][electron-url]
[![Node][node-shield]][node-url]
[![License][license-shield]][license-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![Website][website-shield]][website-url]

<!-- PROJECT LOGO -->
<br />
<p align="center">
  <a href="https://videodb.io/"><img src="assets/Colour_Black Wordmark.png" alt="Bloom" height="72"></a>
</p>

<h3 align="center">An open source, agentic Loom alternative.</h3>

<p align="center">
  Capture on your desktop. Make recordings AI-ready. Run workflows on top.
  <br />
  <br />
  <strong>Record → Query → Automate</strong>
</p>

<p align="center">
  <a href="#installation">Install</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="https://docs.videodb.io"><strong>Docs</strong></a>
  ·
  <a href="https://github.com/video-db/bloom/issues">Report Bug</a>
</p>

---

## What is Bloom?

Bloom is a desktop screen recorder built for agentic workflows, with local library metadata and VideoDB-backed capture sessions.

- **Capture from your desktop** — Screen, microphone and system audio
- **Upload to VideoDB** — Automatic cloud sync with AI processing.
- **Find recordings** — Search the library by name and view generated transcripts.
- **Let agents work on your recordings** — Query via APIs or agent frameworks like Claude Code and access your recordings data.

Recordings are no longer files, they are inputs for AI.

---

## Demo

https://github.com/user-attachments/assets/bf075217-b256-43b7-9369-b5d172bfc6b2

---

## Installation

To install the published build, run:

```bash
curl -fsSL https://artifacts.videodb.io/bloom/install | bash
```

This detects your Mac architecture and installs the published build to `/Applications`. For the version in this checkout, follow the [local build and installation runbook](docs/runbook.md#build-and-install-locally).

<details>
<summary>Manual install — v2.2.0 artifact URLs</summary>

- **Apple Silicon (M1/M2/M3/M4)**: [bloom-2.2.0-arm64.dmg](https://artifacts.videodb.io/bloom/bloom-2.2.0-arm64.dmg)
- **Apple Intel**: [bloom-2.2.0-x64.dmg](https://artifacts.videodb.io/bloom/bloom-2.2.0-x64.dmg)
- **Windows**: [bloom-2.2.0-x64.exe](https://artifacts.videodb.io/bloom/bloom-2.2.0-x64.exe)

1. Mount the DMG and drag Bloom to your Applications folder
2. Open Terminal and run `xattr -cr /Applications/Bloom.app`
3. Launch the app from Applications or Spotlight

</details>

<p>
  <em>The repository includes macOS DMG and Windows NSIS packaging. Verify each build on its target platform using the runbook.</em>
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| **No subscription** | Pay only for usage |
| **Desktop recording** | Capture screen and audio into VideoDB-backed sessions |
| **AI-ready** | Spoken-word indexing and transcripts through VideoDB |
| **Screen recording** | Capture screen, microphone, and system audio via [VideoDB Capture SDK](https://docs.videodb.io) |
| **Camera overlay** | Draggable camera bubble during recording |
| **Floating bar** | Always-on-top control bar that never blocks your apps |
| **Multi-monitor** | Display picker to choose which screen to record |
| **Library** | Browse, search, play, rename, and download recordings |
| **Transcription** | Automatic transcript generation with subtitled playback |
| **Chat with video** | Ask questions about your recording via [VideoDB Chat](https://chat.videodb.io) |
| **Share** | One-click shareable link for any recording |
| **Keyboard shortcut** | `Cmd+Shift+R` to start/stop recording from anywhere |
| **Open source** | Fully customizable UI layer |

---

## Architecture

Architecture, decisions, gaps and active work live in [Products/Bloom in architectures](https://github.com/Spext/architectures/tree/main/Products/Bloom/docs). Build, configuration and operating instructions stay in this repository.

---

## Open source

The UI layer is fully open source.

- **Modify it** — Customize the interface to your needs
- **Extend it** — Add new features and workflows
- **Plug it in** — Integrate with your own systems

Bloom is not just a tool. It's a foundation for building agentic systems on top of recordings.

---

## Philosophy

Your recorder should not trap your data.

It should:

- **Give you access** — Local library metadata and VideoDB-backed recordings
- **Enable intelligence** — AI-ready from day one
- **Power your agents** — APIs and integrations built-in

Bloom is built for that future.

---

## Development Setup

### Prerequisites

- Node.js 18+
- VideoDB API Key ([console.videodb.io](https://console.videodb.io))

### Quick Start

```bash
npm ci
npm start
```

On first launch, grant the required permissions, then enter your VideoDB API key. A network connection and a valid API key are required to start recording.

| Task | Documentation |
|---|---|
| Configure | [Configuration reference](docs/reference/configuration.md) |
| Build, install, verify or reset | [Runbook](docs/runbook.md) |
| Contribute | [Contributor guide](CONTRIBUTING.md) |
| Report a vulnerability | [Security policy](SECURITY.md) |

No automated test or lint command is currently declared in `package.json`.

---

## Project Structure

| Path | Purpose |
|---|---|
| `src/main/index.js` | Electron lifecycle, windows and tray |
| `src/main/ipc/` | Capture, permissions, camera, configuration and library handlers |
| `src/main/services/` | VideoDB sessions, synchronisation, transcripts and subtitles |
| `src/main/db/`, `src/main/lib/` | Local persistence, configuration, logging and runtime paths |
| `src/preload/index.js` | Context-isolated renderer bridge |
| `src/renderer/` | Floating bar, onboarding, permissions, display picker, camera and library |
| `build/` | App icons, macOS entitlements and afterPack signing hook |
| `docs/` | Configuration reference and operating runbook |

## Troubleshooting

### Permissions denied
- **macOS**: System Settings → Privacy & Security → enable Screen Recording / Microphone / Camera

### Camera not showing
- Toggle camera off/on in source controls
- Check Camera permission in system settings

### Reset
Follow [Reset local state](docs/runbook.md#reset-local-state) for the correct userData path and reset procedure.

---

## Building

See the [runbook](docs/runbook.md) for local installation, verification and rollback.

```bash
# Build directory (for testing)
npm run pack

# Build DMG installers (macOS arm64 + x64)
npm run dist
```

---

## License

MIT

---

## Community & Support

- **Docs**: [docs.videodb.io](https://docs.videodb.io)
- **Issues**: [GitHub Issues](https://github.com/video-db/bloom/issues)
- **Discord**: [Join community](https://discord.gg/py9P639jGz)
- **Console**: [Get API key](https://console.videodb.io)

---

<p align="center">
  <a href="https://videodb.io/"><img src="assets/videodb-logo.jpeg" alt="VideoDB" height="40"></a>
</p>

<p align="center">Made with love by the <a href="https://videodb.io">VideoDB</a> team</p>

<!-- MARKDOWN LINKS & IMAGES -->
[electron-shield]: https://img.shields.io/badge/Electron-39.0-47848F?style=for-the-badge&logo=electron&logoColor=white
[electron-url]: https://www.electronjs.org/
[node-shield]: https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white
[node-url]: https://nodejs.org/
[license-shield]: https://img.shields.io/github/license/video-db/bloom.svg?style=for-the-badge
[license-url]: https://github.com/video-db/bloom/blob/main/LICENSE
[stars-shield]: https://img.shields.io/github/stars/video-db/bloom.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/bloom/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/bloom.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/bloom/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
