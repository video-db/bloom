# Configuration

## Sign-in and cloud access

Setup leads with **Sign in with VideoDB**: the console's OAuth 2.1 sign-in with PKCE opens in the browser and returns to a one-time loopback address on `127.0.0.1`. The console's access token lasts 30 days and has no refresh token. Bloom keeps it with the VideoDB user it belongs to, so the account (and the recorder's owner name for its recordings) stays the same across sign-ins. Until VideoDB issues Bloom a client ID, Bloom registers itself once per console and keeps that registration in `sign-in-client.json`. The other way is a VideoDB API key, under **Use an API key instead**. The main process validates either credential with VideoDB before saving it in local `credentials.json` (version 1 for a key, version 2 for a browser sign-in). This internal build stores the key without Keychain encryption, using an owner-only file (0600) and directory (0700) on POSIX systems. Neither credential is ever included in renderer state or logs. Processes running as the same user can read the file. Recording requires a signed-in account; nothing is asked of VideoDB when a recording starts. Sign out from **Bloom → Sign Out** or Settings.

Recordings are stored in a private **Bloom Recordings** collection in the signed-in VideoDB account. The contract with VideoDB is in the [VideoDB boundary reference](videodb-integration.md).

## Files

Bloom keeps its data in the `bloom-next` folder under the system application-support directory (`~/Library/Application Support/bloom-next` on macOS). It never opens the folder used by releases up to 2.3.0, and nothing is migrated from it.

| Path | Purpose |
|---|---|
| `prefs.json` | Saved preferences: appearance, recording defaults, notifications, open at login, setup completion, the version that ran last |
| `updates/` | A downloaded update until it is in place, and how earlier installs went; see the [runbook](../runbook.md#publish-an-update) |
| `videodb-dev/` or `videodb-prod/` | Per-environment local credential, operation receipts and cached library metadata; see [persistence](videodb-integration.md#persistence-and-errors) |

A recording's media is the recorder's: it keeps it until VideoDB confirms the recording and then clears it (architecture ADR 0007). Bloom keeps no file, path or list of files; a `local-recordings.json` left by 2.3.12 or earlier is no longer read. Automated runs use a separate `bloom-next-test` folder so they never read a person's data.

## Environment and flags

The packaged macOS app reads its update feed from `https://artifacts.videodb.io/bloom/latest-mac.json`; `BLOOM_UPDATE_FEED` points it elsewhere, for testing a release. The feed must still be signed with the release key.

The Ubuntu internal build reads its update pointer and signed package checksums from the internal Linux channel on the Bloom artifact host. See the [Linux build and update instructions](../runbook.md#build-and-install-locally).

Release packages use `https://api.videodb.io`. The internal Linux preview built with `build/linux-preview.cjs` and the default source launch use `https://api.dev.videodb.io`.

| Flag | Effect |
|---|---|
| `--toggle-recording`, `--mark-recording` | Linux desktop shortcut commands for starting or stopping capture and marking the current recording |
| `--production` | Use the production API from source |
| `--light`, `--dark` | Force a theme for review |
| `--skip-onboarding`, `--open-main`, `--open-preferences`, `--keep-open` | Start at a given surface, or stop the tray panel closing on blur, for review |
| `--fresh` | Automated run: in-memory preferences, separate data folder, no activation |
| `--fixture` | Automated run: the real engine on a fake service and recorder |

Pass flags after `--`, for example `npm start -- --production`. Each flag can also be set as an environment variable, `BLOOM_<FLAG>=1` with dashes as underscores. A packaged app ignores `--fresh`, `--fixture`, `--skip-onboarding` and `--keep-open`.

## Platform permissions

macOS screen recording and microphone permissions are controlled in System Settings → Privacy & Security. Screen recording also covers system audio. The camera picture needs the Camera permission, which macOS asks for the first time the camera is turned on. The camera is shown on screen by Bloom; it is not a source the recorder captures. The packaged app identity is `com.videodb.bloom`; permission behaviour can differ between development Electron and an installed Bloom build.

## Logs and diagnostics

Bloom writes one log file a day, `bloom.log`, under the `logs` folder of its data folder, and keeps 7 days and at most 50 MB. Everything the main process prints is copied in, including the capture program's lines that the SDK passes on, at most 120 lines a minute, with keys and tokens removed. **Help → Export Diagnostics…** saves a zip with a README, `report.json` (Bloom, SDK, capture and system versions, permissions, account and recording states, no keys or titles) and the redacted logs. Nothing is sent anywhere.
