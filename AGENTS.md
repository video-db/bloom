# Bloom contributor and agent guide

Bloom is the Electron desktop recorder in `video-db/bloom`. Use `git` locally and `gh` for GitHub. Never include credentials, user recordings, generated installers or local agent context in commits.

## Code and checks

- `src/main/`: Electron lifecycle, IPC handlers, persistence and VideoDB services.
- `src/preload/index.js`: main/renderer bridge; keep renderers context-isolated.
- `src/renderer/`: UI, with existing dark/light CSS variables and controls.
- `build/`: native capture packaging and macOS signing hook.
- Install with `npm ci`; run with `npm start`; package with `npm run pack` or `npm run dist`.
- No automated test/lint script is declared. Use `node --check` for CommonJS and `node --input-type=module --check < <file>` for browser ES modules, plus the manual verification in `docs/runbook.md`.
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

## Branding

Use Bloom in product text and `bloom` in package/artifact names. The app ID is `com.videodb.bloom`; the database is `bloom.db`. This cleanup intentionally has no legacy-data migration. SDK binary names and IPC identifiers are technical contracts, not product branding.
