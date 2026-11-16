# Configuration

## Sign-in and cloud access

Bloom asks for a VideoDB API key during setup. The main process validates the key with VideoDB before saving it in local `credentials.json`. This internal build stores the key without Keychain encryption, using an owner-only file (0600) and directory (0700) on POSIX systems. The key is never included in renderer state or logs. Processes running as the same user can read the file. Recording requires a signed-in account; nothing is asked of VideoDB when a recording starts. Sign out from **Bloom → Sign Out** or Settings.

Recordings are stored in a private **Bloom Recordings** collection in the signed-in VideoDB account. The contract with VideoDB is in the [VideoDB boundary reference](videodb-integration.md).

## Files

Bloom keeps its data in the `bloom-next` folder under the system application-support directory (`~/Library/Application Support/bloom-next` on macOS). It never opens the folder used by releases up to 2.3.0, and nothing is migrated from it.

| Path | Purpose |
|---|---|
| `prefs.json` | Saved preferences: appearance, recording defaults, notifications, open at login, setup completion |
| `videodb-dev/` or `videodb-prod/` | Per-environment local credential, operation receipts and cached library metadata; see [persistence](videodb-integration.md#persistence-and-errors) |

A recording's file is kept by the recorder, under `~/Library/Application Support/videodb-recorder/recordings/`, until the recording is playable in VideoDB; Bloom then deletes it (architecture ADR 0006). `local-recordings.json` in the environment folder lists the files Bloom is still responsible for. Automated runs use a separate `bloom-next-test` folder so they never read a person's data.

## Environment and flags

A packaged app uses `https://api.videodb.io`. From source, `npm start` uses `https://api.dev.videodb.io`.

| Flag | Effect |
|---|---|
| `--production` | Use the production API from source |
| `--light`, `--dark` | Force a theme for review |
| `--skip-onboarding`, `--open-main`, `--open-preferences`, `--keep-open` | Start at a given surface, or stop the tray panel closing on blur, for review |
| `--fresh` | Automated run: in-memory preferences, separate data folder, no activation |
| `--fixture` | Automated run: the real engine on a fake service and recorder |

Pass flags after `--`, for example `npm start -- --production`. Each flag can also be set as an environment variable, `BLOOM_<FLAG>=1` with dashes as underscores. A packaged app ignores `--fresh`, `--fixture`, `--skip-onboarding` and `--keep-open`.

## Platform permissions

macOS screen recording and microphone permissions are controlled in System Settings → Privacy & Security. Screen recording also covers system audio. The camera picture needs the Camera permission, which macOS asks for the first time the camera is turned on. The camera is shown on screen by Bloom; it is not a source the recorder captures. The packaged app identity is `com.videodb.bloom`; permission behaviour can differ between development Electron and an installed Bloom build.
