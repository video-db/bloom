# Bloom contributor and agent guide

Bloom is the Electron desktop recorder in `video-db/bloom`. Use `git` locally and `gh` for GitHub. Never include credentials, user recordings, generated installers or local agent context in commits.

## Code and checks

- `src/main/`: Electron lifecycle, tray, windows, notifications, preferences and the validated renderer bridge.
- `src/engine/`: the only code that talks to capture and VideoDB (`videodb/` real, `sample/` for design and tests).
- `src/preload.js`: main/renderer bridge; keep renderers context-isolated.
- `src/ui/`: renderers; `connected/` is the running app. See `src/README.md` for the layout and conventions.
- `build/`: native capture packaging and macOS signing hook.
- Install with `npm ci`; run with `npm start`; package with `npm run pack` or `npm run dist`.
- Run `npm test` for the state and engine tests, and the Electron walkthroughs in `src/tests/*.cjs` as described in `docs/runbook.md`. No lint script is declared.
- Do not assume main has the newest release. Check branch and package version before updating or building.

## Documentation

Follow the [documentation standard](https://github.com/Spext/architectures/blob/main/engineering-standards/docs/service-docs/index.md).

| Content | Canonical home |
|---|---|
| Setup, configuration, contracts, build/install/verify procedures, security policy and changelog | This repository: README, docs/reference, docs/runbook.md and standard root files |
| Architecture, decisions, learnings, gaps, plans and trackers | [architectures Products/Bloom/docs](https://github.com/Spext/architectures/tree/main/Products/Bloom/docs) |

Update code-coupled documentation in the code PR. Open a paired architectures PR for knowledge changes and link it from the code PR. Open a decision's architectures PR first. Link to canonical facts rather than copying them. Cross-repository links use full GitHub URLs.

Update the architectures workstream tracker before each step. Decisions are append-only with rejected alternatives; supersede with a new entry. Learnings describe a reusable practice and include evidence and how it was found. Open gaps, risks and proposals belong only in Bloom's gaps-and-optimisations.md. Descriptive pages state what exists. Label source-only verification honestly; do not claim an installed or production check without evidence.

Write each Markdown prose paragraph on a single source line; let the reader wrap it.

Keep each page's established structure; obtain the owner's approval before a structural redesign. Comments should briefly explain a non-obvious why; keep longer rationale in central decisions or learnings.

## Interface changes

The interface follows the approved designs. Record every change to what a person sees in the [interface change log](https://github.com/Spext/architectures/blob/main/Products/Bloom/docs/trackers/ui-change-log.md) before making it, with what, why and who asked, then add the commit. Wiring a surface to real data keeps its approved layout, controls and wording; if real data needs something the design lacks, stop and ask the owner. One interface change per commit, with the surface named in the message. Only the owner approves a design.

## Branding

Use Bloom in product text and `bloom` in package/artifact names. The app ID is `com.videodb.bloom`; local data lives in the `bloom-next` application-support folder. There is intentionally no legacy-data migration: the app never opens the earlier app's folder. SDK binary names and IPC identifiers are technical contracts, not product branding.
