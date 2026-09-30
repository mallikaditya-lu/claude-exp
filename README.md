# Reference Board

An internal, Milanote-style visual board for collecting references and structuring research as a team.
Put notes, links, embedded video and music, uploads, tables and to-dos on an infinite canvas,
connect them with lines, group them in columns, and nest boards inside boards. Everyone on a board sees
edits, presence and cursors live.

![Cards on the board: headings connected to a script table, notes, a to-do list, embeds and a column](docs/screenshot.png)

## What you can put on a board

| Card | What it does |
| --- | --- |
| **Note** | Rich text: bold, italic, headings, lists, links. Click a selected note (or double-click) to edit. |
| **Heading** | Coloured label for structuring sections ("Hero movie" → "Narration", "Music options"…). |
| **Link** | Paste any URL. YouTube, Vimeo, Loom, Spotify, SoundCloud, Apple Music, Figma, Google Docs/Drive and direct media links become **playable embeds**; other sites get a preview card (title, image, description). |
| **To-do** | Checklist with progress. Enter adds a task and Backspace on an empty task removes it. |
| **Table** | Editable grid for scripts, shot lists and comparisons. Add or remove rows and columns. |
| **Comment** | Threaded comments with author and time. |
| **Board** | A nested board. Double-click to open it; breadcrumbs and the sidebar show the hierarchy. |
| **Column** | Drag cards in and out to group and order them. |
| **Image / Video / Audio / File** | Upload via the toolbar, drag files from your desktop, or paste images. Audio gets an inline player, video a native player, and PDFs and other files a download card. |
| **Line** | FigJam-style connector between two cards: elbow, curved or straight, solid or dashed, three thicknesses, any colour, arrows at none/one/both ends, and an optional label. |

## Projects and backgrounds

- **Projects** group boards like folders. The home page shows every project, recently updated boards, and boards without a project. Open a project to see only its boards. Nested boards follow their parent's project.
- Move a board between projects with the **⋯** menu on its tile. Deleting a project keeps its boards; they become unfiled.
- **Board background:** use the palette button in a board's top bar. Dark backgrounds (Graphite, Charcoal, Midnight, Forest) switch that board's cards and tools to dark grey. The choice is saved on the board, so everyone sees it.

## Using it

- **Add cards:** click a toolbar item (it drops in a free spot) or drag it onto the canvas. Double-click empty canvas for a quick note.
- **Paste anything:** a URL makes a link card, an image uploads, and plain text makes a note.
- **Connect:** select a card and drag any of the four dots (top, right, bottom, left) onto another card. Drop near an edge to attach to that side, or near the middle to let the line pick the best side. The **Line** tool (click two cards) also works.
- **Edit a line:** click it to open its toolbar (colour, thickness, text, dash, line type, arrows). Drag the end circles to re-attach them to another card or side. On elbow lines, every segment has a blue handle: the middle one moves the bend, and the end segments slide along their card (or step out past its edge). Double-click a handle to reset it.
- **Select (like Figma):** drag on empty canvas to box-select. Shift-drag or shift-click adds to the selection.
- **Navigate:** hold **Space** and drag, or drag with the **middle mouse button**, to pan. Scrolling with a trackpad or wheel also pans. ⌘/Ctrl + scroll or pinch to zoom. ⇧1 fits the board to the screen.
- **Resize:** drag the square handle at a selected card's bottom-right corner.
- **Copy between boards:** ⌘C / ⌘V copies cards, including the lines between them, into any board.

| Shortcut | Action |
| --- | --- |
| ⌘Z / ⇧⌘Z | Undo / redo |
| Space + drag / middle-drag | Pan |
| ⌘D | Duplicate |
| ⌘A | Select all |
| Delete / Backspace | Delete selection |
| Arrows (⇧ for 10px) | Nudge |
| Enter | Edit selected card |
| N, H, L, T, B, C | New note, heading, link, to-do, board, line |
| ⌘+ / ⌘− / ⌘0 | Zoom in / out / 100% |

## Running it

Requires Node 20+.

```bash
npm install
npm run dev          # API on :3001 + Vite on http://localhost:5173
```

### Demo project

A new install creates two things: a small example board, and **“Demo · Aurora Summit launch campaign”**. The demo is a large, realistic project that uses every feature: a hub board with six nested workstream boards (one nested three levels deep), a team wiki, an archive, every card type, columns, all connector styles and light and dark backgrounds. Uploaded files are generated on the spot: storyboard frames, moodboard artwork, music demos, a PDF call sheet and a CSV budget.

To add it to an existing install, stop the app and run:

```bash
npm run demo        # adds the demo project to ./data (or $DATA_DIR)
npm start
```

Some demo photos and videos load from the web (picsum.photos, YouTube, Vimeo, Spotify), so those cards need an internet connection.

Production (one process serves the app, API, uploads and WebSocket):

```bash
npm run build
npm start            # http://localhost:3001
```

Or with Docker:

```bash
docker build -t reference-board .
docker run -p 3001:3001 -v reference-board-data:/data -e APP_PASSWORD=choose-one reference-board
```

### Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DATA_DIR` | `./data` | Where boards (`boards/*.json`), projects (`projects.json`) and uploads (`uploads/`) are stored. Back up this folder. |
| `APP_PASSWORD` | *(none)* | Shared team password. Used only when Cloudflare Access isn't configured. |
| `CF_ACCESS_TEAM_DOMAIN` | *(none)* | e.g. `littleunusual.cloudflareaccess.com`. With `CF_ACCESS_AUD`, it turns on per-person sign-in through Cloudflare Access. |
| `CF_ACCESS_AUD` | *(none)* | The Access application's "Application Audience (AUD) Tag" |
| `ADMIN_EMAILS` | `admin@littleunusual.com` | Comma-separated. Always admins, and can't be demoted. |
| `TEAM_DOMAINS` | `littleunusual.co,littleunusual.com` | Email domains that are core team automatically |
| `PUBLIC_URL` | *(none)* | The site's real address (e.g. `https://refs.littleunusual.co`). People who reach the app another way are sent there to sign in. |
| `SHARE_URL` | *(none)* | Address share links are built on, e.g. `https://share.littleunusual.xyz`. It must point at the same app but **not** be behind Cloudflare Access, so clients can open links without signing in. Without it, links use the address the team is on (fine without Cloudflare). |
| `SESSION_SECRET` | *(generated)* | Signs link visitors' cookies. If unset, a random secret is created once in `DATA_DIR/secret`. |
| `MAX_UPLOAD_MB` | `500` | Per-file upload limit |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | *(none)* | Full contents of the service account's JSON key. With `GOOGLE_DRIVE_ID`, it turns on Google Drive storage. |
| `GOOGLE_DRIVE_ID` | *(none)* | ID of the Shared Drive uploads go to |
| `CACHE_MB` | `2048` | Local cache for small files served from Drive (images, PDFs) |

### Sign-in

- **Cloudflare Access (recommended):** Cloudflare puts a login in front of the site: Google sign-in, or a one-time code by email. Who may enter is set in the Access policy (e.g. everyone `@littleunusual.co` plus specific guest emails). The app verifies Cloudflare's signed token on every request, including WebSockets, so the raw Railway address can't be used to skip the login. Each person gets a profile named after their email, which they can rename from the sidebar.
- **Shared password:** set `APP_PASSWORD`. Everyone chooses their own display name.
- **Neither:** open access. Only for local use.

### Who can see what

| Role | Who | Can |
| --- | --- | --- |
| **Admin** | `ADMIN_EMAILS` (default `admin@littleunusual.com`), plus anyone promoted | Everything, plus the **Admin** page: people, roles, inactivity settings |
| **Core team** | Anyone with an email in `TEAM_DOMAINS` (default `littleunusual.co`, `littleunusual.com`), plus anyone added on the Admin page | See and edit every project, create projects, invite people |
| **Guest** | Everyone else (freelancers, clients) | Only the projects and boards they're invited to, as **editor**, **commenter** or **viewer** |
| **Link visitor** | Anyone who opens a share link (no sign-in) | Only the shared board and the boards inside it, as **viewer** or **commenter** |

- **Sharing one board:** open the board and click **Share**. Invite people by email to just that board (and the boards inside it), or turn on the link.
- **Share links:** *Anyone with the link can view* or *…can comment*. No sign-in or email invite is needed: visitors type their name and email (the team can turn that off for view-only links; commenting always asks). They're remembered on that device, and entering the same email on another device brings back their comments. The **Comments** panel lists every thread, with a *Yours* filter. Editing always needs an email invite. **Reset link** makes a new link and stops the old one; switching the link off removes access straight away, even for people who have it open. Visitors' names and emails aren't verified, so a link is for review, not for anything confidential. The Admin page lists everyone who has opened a link.
- **Inviting to a project:** open a project and click **Share**. Enter emails and pick *Can edit / Can comment / Can view*. Guests sign in with a one-time code and see only those projects. Removing someone takes effect immediately, even if they have the board open.
- **Commenters** can add comment cards and reply. They can't move or change anything else. **Viewers** can only look.
- **Inactive guests** lose their project and board access after the period set on the Admin page (default 60 days). Invites that were never used are removed too. The core team is never removed.
- **Enforcement:** the server applies every rule to boards, files, uploads, live updates and board lists. A guest can't reach another project's boards or files by guessing links.
- For invites to work without editing Cloudflare each time, the Cloudflare Access policy should let anyone sign in with a one-time PIN. The app then decides what each person can see.

### Storage: local disk or Google Drive

Without Google settings, uploads are saved in `DATA_DIR/uploads`. With both Google variables set, they go to the **Google Shared Drive**, in one folder per project, and cost nothing beyond your Workspace storage:

- Uploads are sent in 16 MB chunks, then pushed to Drive with Google's resumable protocol, so big videos survive flaky connections and proxy size limits.
- Small files (under 25 MB) are cached on the server so boards open fast. Larger files stream from Drive with byte ranges, so video seeking works.
- Card URLs are always `/uploads/<name>`, so files uploaded before Drive was switched on keep working.
- Board data is backed up daily to `_Backups (board data)` on the Drive (the last 30 days are kept), or to `DATA_DIR/backups` in local mode.

Check a Drive setup with `npm run drive:check`. `scripts/fake-google.mjs` is a stand-in Google server for testing without credentials (see CLAUDE.md).

## How it works

- **Frontend:** React + TypeScript (Vite). The canvas uses DOM cards positioned in a transformed "world" layer, with an SVG layer for lines.
- **Backend:** Express (`server/`). Each board is one JSON file, written atomically. Uploads are stored on disk and served from `/uploads`.
- **Sync:** edits apply locally at once, then a debounced diff sends **only the changed cards** to the server. The server fans that patch out to everyone on the board over WebSocket. Two people editing different cards never overwrite each other. If both edit the *same* card at once, the last write wins. After a dropped connection the client refetches and re-applies anything unsent.
- **Link previews:** the server fetches Open Graph data. It refuses private/internal addresses (including through redirects), so it can't be used to probe your network.
- **Uploads:** HTML/SVG/JS files are served as downloads with a sandbox CSP, so an uploaded file can't run scripts on the app's origin.

## Project layout

```
server/
  index.js      HTTP API, uploads, auth, WebSocket fan-out
  store.js      board + project storage, patch application
  unfurl.js     link previews (SSRF-guarded)
  access.js     Cloudflare Access token verification
  users.js      people, roles (admin/team/guest), inactivity settings
  visitors.js   share-link visitors (name + email, signed cookie)
  permissions.js who can view/comment/edit which board; enforced in index.js
  seed.js       first-run example board
  demo.js       the large demo project (demo-assets.js generates its files; demo-cli.js = npm run demo)
src/
  App.tsx       shell, routing (#/b/<id>), login + name prompt
  components/ShareApp.tsx  the client view for share links (/s/<token>)
  useBoard.ts   local-first board state, undo/redo, save + live sync
  lib.ts        embeds, colours, diff/patch helpers
  connectors.ts line routing: sides, elbow/curved/straight paths, arrowheads
  components/
    Canvas.tsx  pan/zoom, drag, columns, lines, clipboard, keyboard
    items/      one component per card type
```

## Known limits / next ideas

- Concurrent edits to the *same* card are last-write-wins. Per-character merging would need a CRDT such as Yjs.
- No freehand drawing or full-text search across card contents yet. The sidebar searches board titles only.
