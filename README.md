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
| **Line** | Curved arrow (Figma-style) connecting two cards, with an optional label and colour. |

## Projects and backgrounds

- **Projects** group boards like folders. The home page shows every project, recently updated boards, and boards without a project. Open a project to see only its boards. Nested boards follow their parent's project.
- Move a board between projects with the **⋯** menu on its tile. Deleting a project keeps its boards; they become unfiled.
- **Board background:** use the palette button in a board's top bar. Dark backgrounds (Graphite, Charcoal, Midnight, Forest) switch that board's cards and tools to dark grey. The choice is saved on the board, so everyone sees it.

## Using it

- **Add cards:** click a toolbar item (it drops in a free spot) or drag it onto the canvas. Double-click empty canvas for a quick note.
- **Paste anything:** a URL makes a link card, an image uploads, and plain text makes a note.
- **Connect:** select a card, then drag the purple dot on its right edge onto another card. Or use the **Line** tool and click two cards.
- **Move and select:** drag cards, shift-drag on the canvas to box-select, and shift-click to add to a selection.
- **Navigate:** drag the canvas or scroll to pan. ⌘/Ctrl + scroll or pinch to zoom. ⇧1 fits the board to the screen.
- **Resize:** drag the square handle at a selected card's bottom-right corner.
- **Copy between boards:** ⌘C / ⌘V copies cards, including the lines between them, into any board.

| Shortcut | Action |
| --- | --- |
| ⌘Z / ⇧⌘Z | Undo / redo |
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
| `APP_PASSWORD` | *(none)* | Shared team password. **Set this for anything reachable beyond your machine.** |
| `MAX_UPLOAD_MB` | `500` | Per-file upload limit |

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
  seed.js       first-run example board
src/
  App.tsx       shell, routing (#/b/<id>), login + name prompt
  useBoard.ts   local-first board state, undo/redo, save + live sync
  lib.ts        embeds, colours, diff/patch helpers
  components/
    Canvas.tsx  pan/zoom, drag, columns, lines, clipboard, keyboard
    items/      one component per card type
```

## Known limits / next ideas

- Auth is one shared password, with no per-user accounts or per-board permissions.
- Concurrent edits to the *same* card are last-write-wins. Per-character merging would need a CRDT such as Yjs.
- No freehand drawing or full-text search across card contents yet. The sidebar searches board titles only.
