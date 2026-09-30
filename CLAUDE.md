# Reference Board: notes for Claude sessions

Internal Milanote-style board for Little Unusual (film/brand studio). Owner: Aditya.
Read README.md for features and configuration. This file covers conventions and setup facts.

## Stack
- `server/`: plain Node ESM + Express 5, no build step. Boards are JSON files (`DATA_DIR/boards`), projects are in `projects.json`, and the uploads index is in `files.json`.
- `src/`: React 19 + TypeScript + Vite. `Canvas.tsx` is the core; `connectors.ts` does line routing; `useBoard.ts` does sync (item-level patches over REST, fan-out over WebSocket `/ws`).
- No database and no native dependencies. Keep it that way unless there's a strong reason.

## Commands
- `npm run dev`: API on :3001 plus Vite on :5173
- `npm run build`: typecheck and build (run before every commit)
- `npm run demo`: add the big demo project to an existing data dir (the app must be stopped)
- `npm run drive:check`: end-to-end check of the Google Drive credentials

## Storage (decided with the owner)
- Production uses **Google Shared Drive "Reference Board"** (Workspace, 2 TB pooled).
  - Shared Drive ID: `0AM6JVXPCU2XoUk9PVA`
  - Service account: `reference-board-storage@reference-board-510209.iam.gserviceaccount.com` (Content manager on the drive)
  - Env: `GOOGLE_SERVICE_ACCOUNT_JSON` (the secret: never commit it, never ask for it in chat), `GOOGLE_DRIVE_ID`.
- Test Drive code without credentials:
  ```
  FAIL_RATE=0.25 node scripts/fake-google.mjs 4010 &
  GOOGLE_API_BASE=http://localhost:4010 GOOGLE_TOKEN_URL=http://localhost:4010/token \
  GOOGLE_DRIVE_ID=x GOOGLE_SERVICE_ACCOUNT_JSON="$(cat fake-creds.json)" npm start
  ```
  (fake-creds.json: any service-account-shaped JSON with an RSA `private_key`; the fake doesn't verify signatures.)

## Deployment plan (in progress)
1. ✅ Google Drive storage, chunked uploads, daily backups
2. Railway (Hobby) with a Dockerfile deploy from GitHub `main`, plus a volume at `/data`; a staging service for testing
3. Cloudflare DNS plus Access (Google login for the team), replacing `APP_PASSWORD`
4. Client share links (view/comment) and per-project access
5. Later: video compression and thumbnails (ffmpeg), version history, search

## Conventions
- Test UI changes in a real browser with Playwright (global install; Chromium at /opt/pw-browsers) before pushing.
- When killing test servers, match `^node server/index.js`. Unanchored `pkill -f` patterns match the shell itself.
- Keep README.md current when features or config change.
