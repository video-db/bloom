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
  Record locally. Make recordings AI-ready. Run workflows on top.
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
  <a href="https://github.com/video-db/async-recorder/issues">Report Bug</a>
</p>

---

## What is Bloom?

Bloom is a local-first screen recorder built for agentic workflows. Recordings are no longer files. They are inputs for AI.

- **Record locally** — No lock-in, your files stay yours
- **Upload to VideoDB** — Automatic cloud sync with AI processing. 
- **Find any moment** — Transcripts, visual embeddings, metadata.
- **Let agents work on your recordings** — Query via APIs or agent frameworks like claude code

This is not just recording. This is turning context into action.

---

## Installation

Run this in your terminal to install Bloom:

```bash
curl -fsSL https://artifacts.videodb.io/bloom/install | bash
```

This will automatically detect your Mac architecture, download the right build, and install it to `/Applications`.

<details>
<summary>Manual install</summary>

- **Apple Silicon (M1/M2/M3/M4)**: [bloom-2.0.0-arm64.dmg](https://artifacts.videodb.io/bloom/bloom-2.0.0-arm64.dmg)
- **Apple Intel**: [bloom-2.0.0-x64.dmg](https://artifacts.videodb.io/bloom/bloom-2.0.0-x64.dmg)

1. Mount the DMG and drag Bloom to your Applications folder
2. Open Terminal and run `xattr -cr /Applications/Bloom.app`
3. Launch the app from Applications or Spotlight

</details>

<p>
  <em>Pre-built builds are available for macOS. Linux support coming soon.</em>
</p>

---


## Features

| Feature | Description |
|---------|-------------|
| **No subscription** | Pay only for usage |
| **Local-first** | Record locally, no lock-in |
| **AI-ready** | Search, summarize, extract |
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

```
Bloom = UI layer (open source)
VideoDB = Intelligence layer (cloud)
```

```mermaid
graph LR
    subgraph EA["  Electron App  "]
        R["Renderer UI"]
        M["Main Process"]
        DB[("SQLite")]
        R -->|IPC| M
        M --> DB
        M --> SDK
    end

    subgraph VS["  VideoDB SDK  "]
        SDK["Node SDK"]
        CC["CaptureClient"]
        WS["WebSocket"]
        API["Connection API"]
        BIN["Native Binary"]
        SDK --> CC & WS & API
        CC --> BIN
    end

    subgraph LC["  Local Capture  "]
        SC["Screen Capture"]
        MIC["Microphone"]
        SA["System Audio"]
        BIN --> SC & MIC & SA
    end

    subgraph VC["  VideoDB  "]
        UPLOAD["Upload & Export"]
        STREAM["HLS Streaming"]
        IDX["Indexing"]
        TRX["Transcription"]
        UPLOAD --> STREAM
        IDX --> TRX
    end

    BIN -->|"upload chunks"| UPLOAD
    WS -->|"session events"| UPLOAD
    API -->|"index / transcribe"| IDX

    classDef orange fill:#2e1a08,stroke:#EC5B16,stroke-width:1.5px,color:#f5a36a
    classDef amber  fill:#2e2008,stroke:#E8A317,stroke-width:1.5px,color:#f5d080
    classDef red    fill:#2e0d08,stroke:#FF4000,stroke-width:1.5px,color:#ff8a60
    classDef green  fill:#0d2e1a,stroke:#4CAF50,stroke-width:1.5px,color:#8ed4a0
    classDef db     fill:#1a1208,stroke:#EC5B16,stroke-width:1.5px,color:#f5a36a

    class R,M orange
    class SDK,CC,WS,API,BIN amber
    class SC,MIC,SA red
    class UPLOAD,IDX,TRX,STREAM green
    class DB db

    style EA fill:#1a0e04,stroke:#EC5B16,stroke-width:2px,color:#f5a36a
    style VS fill:#1a1504,stroke:#E8A317,stroke-width:2px,color:#f5d080
    style LC fill:#1a0804,stroke:#FF4000,stroke-width:2px,color:#ff8a60
    style VC fill:#071810,stroke:#4CAF50,stroke-width:2px,color:#8ed4a0
```

**Recording flow:** The app creates a `CaptureClient` which spawns a native binary to capture screen, mic, and system audio. Chunks are uploaded to VideoDB Cloud in real-time. A WebSocket connection delivers session events (started, stopped, exported) back to the app.

**Post-recording:** Once the video is exported, the app calls the VideoDB API to index spoken words, generate a transcript, and create a subtitled stream — all available for in-app HLS playback or sharing via URL.

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

- **Give you ownership** — Local-first, no lock-in
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
npm install
npm start
```

On first launch, grant microphone and screen recording permissions, then enter your name and VideoDB API key.

---

## Project Structure

```
src/
├── main/                       # Electron Main Process
│   ├── index.js                # App entry, windows, tray, IPC routing
│   ├── db/
│   │   └── database.js         # SQLite via sql.js
│   ├── ipc/                    # IPC handlers
│   │   ├── capture.js          # Recording start/stop, channels, devices
│   │   ├── permissions.js      # Permission check/request/open settings
│   │   ├── camera.js           # Camera bubble control
│   │   └── auth.js             # Login, logout, onboarding
│   ├── lib/                    # Utilities
│   │   ├── config.js           # App config
│   │   ├── logger.js           # File + console logging
│   │   ├── paths.js            # App paths (DB, config, logs)
│   │   └── videodb-patch.js    # Binary relocation for packaged apps
│   └── services/
│       ├── videodb.service.js  # VideoDB SDK wrapper
│       ├── session.service.js  # Session tokens, WebSocket, sync
│       └── insights.service.js # Transcript + subtitle indexing
├── renderer/                   # Renderer (context-isolated)
│   ├── index.html              # Floating bar page
│   ├── renderer.js             # Bar init + event routing
│   ├── permissions.html        # Permissions modal window
│   ├── onboarding.html         # Onboarding modal window
│   ├── history.html            # Library window
│   ├── history.js              # Library — list, player, download, share, sync
│   ├── display-picker.html     # Display picker popup
│   ├── camera.html             # Camera bubble
│   ├── ui/
│   │   └── bar.js              # Bar controls, toggles, timer, devices
│   ├── utils/
│   │   ├── permissions.js      # Permission check/request utility
│   │   └── logger.js           # Renderer-side logging
│   └── img/                    # Icons, brand assets, animated previews
└── preload/
    └── index.js                # Context bridge (renderer ↔ main)

build/
├── afterPack.js                # electron-builder hook (codesign, plist patch)
├── entitlements.mac.plist      # macOS entitlements
└── icon.icns                   # App icon
```


## Troubleshooting

### Permissions denied
- **macOS**: System Settings → Privacy & Security → enable Screen Recording / Microphone / Camera

### Camera not showing
- Toggle camera off/on in source controls
- Check Camera permission in system settings

### Reset
```bash
# Delete the app database (stored in Electron userData)
# macOS
rm ~/Library/Application\ Support/bloom/bloom.db
rm ~/Library/Application\ Support/bloom/config.json
```
Then run `npm start`

---

## Building

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
- **Issues**: [GitHub Issues](https://github.com/video-db/async-recorder/issues)
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
[license-shield]: https://img.shields.io/github/license/video-db/async-recorder.svg?style=for-the-badge
[license-url]: https://github.com/video-db/async-recorder/blob/main/LICENSE
[stars-shield]: https://img.shields.io/github/stars/video-db/async-recorder.svg?style=for-the-badge
[stars-url]: https://github.com/video-db/async-recorder/stargazers
[issues-shield]: https://img.shields.io/github/issues/video-db/async-recorder.svg?style=for-the-badge
[issues-url]: https://github.com/video-db/async-recorder/issues
[website-shield]: https://img.shields.io/website?url=https%3A%2F%2Fvideodb.io%2F&style=for-the-badge&label=videodb.io
[website-url]: https://videodb.io/
