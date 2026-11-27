# Contributing

We welcome contributions! Here's how to get started:

## Setup

```bash
git clone https://github.com/video-db/bloom.git
cd bloom
npm ci
npm start
```

## Development

- **Run**: `npm start` — launches the Electron app directly
- **Main process**: `src/main/` — tray, windows, notifications, preferences, renderer bridge
- **Engine**: `src/engine/` — capture and VideoDB; the only code that talks to either
- **Renderer**: `src/ui/` — onboarding, tray panel and main window
- **Preload**: `src/preload.js` — context bridge between renderer and main

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes with clear commit messages
3. Run the [verification checks](docs/runbook.md#verify) and update code-coupled docs in the same PR.
4. Open a Pull Request against `main`; link the paired architectures PR when architecture, decisions or plans change.

Read [AGENTS.md](AGENTS.md) for documentation placement and contributor checks.

## Issues

Report bugs or request features at [GitHub Issues](https://github.com/video-db/bloom/issues).

## License

Contributions are licensed under MIT.
