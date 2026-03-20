# Contributing

We welcome contributions! Here's how to get started:

## Setup

```bash
git clone https://github.com/video-db/bloom.git
cd bloom
npm install
npm start
```

## Development

- **Run**: `npm start` — launches the Electron app directly
- **Main process**: `src/main/` — window management, IPC handlers, services
- **Renderer**: `src/renderer/` — UI (floating bar, library, camera bubble)
- **Preload**: `src/preload/index.js` — context bridge between renderer and main

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes with clear commit messages
3. Open a Pull Request against `main`

## Issues

Report bugs or request features at [GitHub Issues](https://github.com/video-db/bloom/issues).

## License

Contributions are licensed under MIT.
