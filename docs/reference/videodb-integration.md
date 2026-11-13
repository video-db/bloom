# VideoDB boundary

The trusted-process service in `src/engine/videodb/` is separate from the engine's renderer-facing state surface. `npm start` runs the real state engine. A packaged app uses the production API. The integration plan and SDK handoff are canonical in [Bloom's architecture tracker](https://github.com/Spext/architectures/blob/main/Products/Bloom/docs/trackers/integration-v1.md).

## Construction

Call `createVideoDBBoundary` from Electron main after `app.whenReady()`. Pass Bloom's own data directory; never the folder used by releases up to 2.3.0. Construction loads dependencies and any operation journal but performs no network requests, launches no capture process and requests no permissions.

```javascript
const { app } = require('electron');
const { createVideoDBBoundary } = require('./src/engine/videodb');

app.whenReady().then(() => {
  const service = createVideoDBBoundary({
    dataDir: app.getPath('userData'),
    apiUrl: 'https://api.dev.videodb.io',
  });
});
```

The service constructor defaults to development. Production can be explicitly selected with `https://api.videodb.io`; arbitrary origins are rejected. Each environment has its own credential and operation files under `videodb-dev/` or `videodb-prod/`. The SDK is installed as `videodb-capture` from `github:video-db/videodb-node#release-0.3.3`; package-lock.json records the resolved revision. The SDK recorder adapter uses public CaptureClient lifecycle APIs, not the native development wrapper. HLS playback code is bundled as the hls.js dependency; no player code is loaded from a CDN.

## Public operations

| Method | Contract |
|---|---|
| `signIn(apiKey)` / `restore()` | Validate through collection discovery before saving local credentials or replacing the active scope. A failed connection preserves the previous scope. Return non-secret scope and collection identifiers; never return the key |
| `signOut()` | Remove the saved credential and invalidate delayed reads. Pending or uncertain mutations block sign-out/account switching |
| `ensureCollection()` | Explicitly create a private Bloom Recordings collection only when missing. Sign-in and library browsing do not create one |
| `listRecordings()` / `getPlayback(id, collectionId?)` | Use the bound Bloom collection, or for `getPlayback` another collection of the same account when one is named; return projected metadata and validated HTTPS playback/thumbnail URLs. Existing thumbnail metadata is displayed without generation; missing or failed images keep the placeholder. No indexing or generation is triggered |
| `usage()` / `listCollections()` / `listCollectionVideos(id)` | Read-only views of the account: the credit balance, every collection by id and name with Bloom's own marked, and one collection's videos in the same projection. Videos from another collection are browsed read-only: the engine marks them and refuses rename, delete and transcript requests for them |
| `renameCollection(id, title)` / `deleteCollection(id)` / `reconcileCollectionAction(id)` | Rename preserves the existing description; deletion removes the collection and its media after UI confirmation. Mutations are journalled and uncertain outcomes require reconciliation. The bound Bloom recording destination is protected from rename/delete and its name is reserved. An uncertain deletion remains in the sidebar until confirmed, including after restart |
| `search(query)` | Semantic search over the spoken index of the bound Bloom collection through the SDK's legacy search; returns video id, start, end and the spoken text. An empty answer is an empty list. Covers only recordings that have been transcribed. The SDK's newer search and `ask` need indexes Bloom does not create |
| `rename(id, title)` / `deleteRecording(id)` | Persist an operation receipt before mutation, serialize conflicting mutations and resolve only on acknowledgement |
| `pendingOperations()` | Return safe pending operation descriptions for recovery UI |
| `reconcileRecording(id)` / `reconcileCollection()` | Read remote evidence. Clear an uncertain rename only if its intended title matches, a delete only on confirmed absence, and collection creation only on one unambiguous matching collection. An unmatched read is not permission to replay |
| `transcript(id, collectionId?)` | Read text and word timestamps without indexing. Playback and transcript reads are independent; failed or empty refreshes retain cached transcript text and paragraph timings. Accepted indexing is remembered locally so Try again only reads the result. Empty text is `empty`, not proof of no speech; malformed or failed responses are errors |
| `summarise(paragraphs)` | Generate a short title, summary, key points and action items from transcript paragraphs with their start times, through the collection's text generation in JSON mode. Returns only validated text, with each point's time kept only when it falls inside the recording. Sends at most 24,000 characters of transcript |
| `requestTranscript(id)` | Explicitly request spoken indexing, check `success:true`, and retain a confirmed receipt to deduplicate requests across restart. Uncertain indexing is not automatically retried |
| `prepareDownload(id)` | Return a validated HTTPS download URL and safe filename. The host still owns the save dialog and actual file transfer |
| `createSession(operationId)` / `ownsSession(id)` / `reconcileSession()` | Create a session in the bound collection, verify a retained session through that collection before recovery, or reconcile an uncertain creation by its persisted operation identity |
| `recorderToken({ sessionId })` | Verify collection/session ownership and mint a new token for the returned endUserId, bypassing token caches. With no session ID, issue only a bootstrap token for discovery. This is sensitive main-process data and must never be broadcast to renderers or logged |
| `captureCapabilities()` | Report missing public lifecycle methods. Reject an outdated client missing relayRecording, listLocalRecordings or waitForProcessing |

Duplicate Bloom collection names are rejected instead of silently selecting a collection. Keys and environments have separate internal scope fingerprints; a rotated key gets an isolated scope and requires a remote library refresh. These fingerprints do not establish a stable cross-key VideoDB account identity.

## Persistence and errors

`credentials.json` holds a versioned local API key record without encryption at rest, per the owner’s internal-build storage decision. No Keychain API is called. The earlier `key.enc` file is ignored: enter the key once after updating. Sign-out removes both credential files. `operations.json` contains a versioned allowlisted set of operation identities, intended rename titles and confirmation states, never credentials, media URLs or raw SDK responses. Writes use unique temporary files, restrictive permissions, file sync, directory sync on platforms supporting it, and atomic rename. `library.json` caches allowlisted recording fields and marks separately; media paths and playback URLs are excluded. Corrupt library data is copied aside before rebuilding from cloud recordings and native jobs. Corrupt files are retained and reported; they are not silently reset. This journal does not replace the native recorder's media/relay journal.

The default host request deadline is 30 seconds. A deadline ends the host wait, not the SDK request or a remote mutation. Uncertain mutations remain in the journal and are not replayed automatically. Confirmed indexing receipts survive restart. Uncertain indexing/session mutations without sufficient remote evidence remain pending for explicit recovery handling; a service caller must not display a generic Retry that resubmits them.

Errors crossing the service boundary use safe `code`, `message` and `uncertain` fields and omit SDK messages, causes, headers and URLs. Playback and download URLs are main-process transient results, not journal content. The host validates IPC senders and payloads, projects service results into engine state, and supplies the renderer with allowed actions; no renderer imports this module or the SDK.

## Verification

Run `node --test src/tests/videodb-service.test.js` for fake-SDK checks of collection isolation, acknowledgement, timeouts, late-result reconciliation, restart receipts, account switching, credential persistence and permissions, corruption and safe error mapping. These tests make no network requests and start no capture. `videodb-engine.test.js` verifies the capture state machine, source exclusion, pause timing, recovery and shutdown against a fake recorder; `videodb-recorder.test.js` verifies the SDK adapter. `app-ui.cjs light` and `dark` verify the views with the real engine on a fake service and recorder, with external media requests blocked. The --fixture mode is ignored by packaged builds. `node --check` applies to every module in this boundary. Installed binary checks and real recording/playback acceptance are separate evidence in the architecture tracker.

## Engine and renderer integration

`engine.js` owns application state and emits cloned snapshots through getState/onState. Validated command acceptance does not mean asynchronous work succeeded; confirmed outcomes appear in state. `access.js`, `capture.js`, `jobs.js` and `library-commands.js` own account orchestration, capture transitions, native-job recovery and recording actions respectively. `collection-actions.js` owns journalled collection mutations and reconciliation. `explore-commands.js` owns what the app shows about the account beyond its own recordings: collections, the balance, the collection being browsed and the last search. `understand-commands.js` owns a recording's summary, and `paragraphs.js` turns word timings into the paragraphs both the transcript view and the summary use. VideoDB times each word as `{ text, start, end }` and marks silences with `-`; the service drops the markers. The SDK-specific calls and event names live only in `recorder.js`. The renderer modules never import the SDK or receive credentials, native paths or raw event payloads.

The first release includes API-key sign-in, OS permission rechecks, discovered display/microphone selection, optional system audio, Start/Pause/Resume/Stop, marks, local-finalization/upload states, native recovery, cloud playback, links, existing/explicitly requested transcripts, rename/delete/download, settings and readiness notifications. Capture is online at start, uses one screen and optional selected audio with store:false, and uploads the local MP4 as the final video. No server-storage fallback is introduced. New capture is serialized against active unfinished jobs. After confirmed Stop, a failed retained job can be explicitly suspended with “Leave for recovery and record again”; it remains in the library and is not deleted. The SDK adapter withholds automatic relay credentials for suspended jobs in that process, and manual retry is blocked during another active capture. Start/Stop timeouts preserve an uncertain capture state instead of enabling another Start. An acknowledged Stop is distinct from local finalization and processing completion. Playback readiness is independent of transcription or rename acknowledgement.

Closing the app while capture or saving is active asks first. The engine awaits Stop before public completion-aware shutdown; explicit suspension retains native pending jobs for subsequent discovery. The current native format does not guarantee recovery of an unfinished MP4 after a forced process kill. Opening the app never starts capture automatically; recording requires its Start action. Unsupported editing, versions, camera, live transcript and meeting-detection controls are absent from this release.
