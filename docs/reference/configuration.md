# Configuration

## Registration and cloud access

Bloom prompts for a name and VideoDB API key. The main process validates the key with VideoDB before creating or reusing a local user. Recording requires a network connection, a valid registered user and successful cloud capture-session creation.

The SDK uses a **Bloom Recordings** collection for capture sessions. The application requests short-lived capture tokens from VideoDB through the SDK.

## Files

All runtime paths below are relative to Electron's `app.getPath('userData')`. Check the logged database/config paths when distinguishing development and installed builds.

| File | Purpose |
|---|---|
| `bloom.db` | SQLite users, API keys, local access tokens, recording metadata and cached insights |
| `config.json` | Selected local access token, user name and saved UI settings, including theme |
| `app.log` | Main-process application log |
| `bin/` | Writable copy of packaged SDK capture binaries and their runtime files |

The database and configuration are local files containing credentials; exclude them from version control and shared troubleshooting output. This version uses `bloom.db` directly and does not migrate earlier local databases. Register again after a fresh database is created.

## Environment

Startup loads `src/.env`, resolved from `src/main/index.js`. Environment variables can also be supplied by the launching shell. The root `.env` constant in `src/main/lib/paths.js` is not used by startup.

| Variable | Default | Effect |
|---|---|---|
| `VIDEODB_API_URL` | SDK default | Overrides the API URL for the main VideoDB service and CaptureClient construction |

Insights processing constructs its own SDK connection; its current call path does not forward this override. Treat an API override as specific to the listed clients.

## One-time registration file

An optional root `auth_config.json` contains `apiKey` and `name`. Startup validates the key, creates or reuses the local user, saves the selected user and removes the setup file. Invalid-key files are removed as well. Normal use is registration through the UI; no setup npm script is declared.

## Platform permissions

macOS screen recording, microphone and camera permissions are controlled in System Settings → Privacy & Security. Packaged app identity is `com.videodb.bloom`. Permission behaviour can differ between development Electron and an installed Bloom build.
