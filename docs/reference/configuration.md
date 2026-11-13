# Configuration

## Sign-in and cloud access

Bloom asks for a VideoDB API key during setup. The main process validates the key with VideoDB before saving it in local `credentials.json`. This internal build stores the key without Keychain encryption, using an owner-only file (0600) and directory (0700) on POSIX systems. The key is never included in renderer state or logs. Processes running as the same user can read the file. Recording requires a network connection at start and a signed-in account. Sign out from **Bloom → Sign Out** or Settings.

Recordings are stored in a private **Bloom Recordings** collection in the signed-in VideoDB account. The contract with VideoDB is in the [VideoDB boundary reference](videodb-integration.md).

## Files

Bloom keeps its data in the `bloom-next` folder under the system application-support directory (`~/Library/Application Support/bloom-next` on macOS). It never opens the folder used by releases up to 2.3.0, and nothing is migrated from it.

| Path | Purpose |
|---|---|
| `prefs.json` | Saved preferences: appearance, recording defaults, notifications, open at login, setup completion |
| `videodb-dev/` or `videodb-prod/` | Per-environment local credential, operation receipts and cached library metadata; see [persistence](videodb-integration.md#persistence-and-errors) |

The native recorder owns local recording files and its own upload receipts until VideoDB confirms ingestion. Automated runs use a separate `bloom-next-test` folder so they never read a person's data.

## Environment and flags

A packaged app uses `https://api.videodb.io`. From source, `npm start` uses `https://api.dev.videodb.io`.

| Flag | Effect |
|---|---|
| `--production` | Use the production API from source |
| `--light`, `--dark` | Force a theme for review |
| `--skip-onboarding`, `--open-main`, `--open-preferences`, `--keep-open` | Start at a given surface, or stop the tray panel closing on blur, for review |
| `--fresh` | Automated run: in-memory preferences, separate data folder, no activation |

Pass flags after `--`, for example `npm start -- --production`. Each flag can also be set as an environment variable, `BLOOM_<FLAG>=1` with dashes as underscores.

## Platform permissions

macOS screen recording and microphone permissions are controlled in System Settings → Privacy & Security. Screen recording also covers system audio. Camera capture is not part of this release. The packaged app identity is `com.videodb.bloom`; permission behaviour can differ between development Electron and an installed Bloom build.
