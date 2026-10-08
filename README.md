# Reference Board

An internal, Milanote-style visual board for collecting references and structuring research as a team.
Put notes, links, embedded video and music, uploads, tables and to-dos on an infinite canvas,
connect them with lines, group them, and nest boards inside boards. Everyone on a board sees
edits, presence and cursors live.

![Cards on the board: headings connected to a script table, notes, a to-do list, embeds and a column](docs/screenshot.png)

## What you can put on a board

| Card | What it does |
| --- | --- |
| **Text** | Rich text: bold, italic, lists, links. Switch its style in the selection bar: **Text, H1, H2, H3**, or **Label** (a coloured section label like "Hero movie" → "Narration"). Click a selected text card (or double-click) to edit. |
| **Link** | Paste any URL. YouTube, Vimeo, Loom, Spotify, SoundCloud, Apple Music, Figma, Google Docs/Drive and direct media links become **playable embeds**; other sites get a preview card (title, image, description). Video links (YouTube, Vimeo, Loom) show a poster: **Play opens a large player beside the board** (drag its edge to resize, Esc to close) so you can keep working while watching. **Posts on X (Twitter)** keep their preview card; its play button or title opens the post beside the board (X's own embed, so videos and GIFs play there) instead of a new tab. To keep a link card short, select it (or several) and click **Hide description** in the selection bar: only the title stays, and hovering the title shows the description. No URL footer: instead every link, video, audio and file card can have your own **note** underneath (select it and click *+ Add a note*). |
| **To-do** | Checklist with progress. Enter adds a task and Backspace on an empty task removes it. |
| **Table** | Grid for scripts, shot lists and comparisons. Cells can hold images, GIFs, videos and links: paste or drop them into a cell (a line that is a media link shows the media; other links become chips). Drag header borders to resize columns; Tab moves to the next cell. |
| **Comment** | Figma-style pins: press **M** (or the Comment tool) and click anywhere, or on a card (the pin then moves with the card). Click a pin to reply, resolve it, or edit or delete your own comments. The **Comments** panel on the right lists every thread, open or resolved, with an *Only yours* filter. |
| **Board** | A nested board. Double-click to open it; breadcrumbs and the sidebar show the hierarchy. |
| **Group** | A titled area for cards. With the **magnet on** (*Auto-arrange*, the default) the cards pack into columns like a masonry wall: each card goes into the shortest column, so a short image never leaves a gap beside a tall one (1–4 columns, or **Auto**, which fits as many as the width allows). Turn the magnet off (*Free*) to place cards anywhere inside the group; they keep their spots, and snapping still lines them up. Drag either side edge to resize. Select cards and press **⌘G** to group them, **⇧⌘G** to ungroup; drag cards in and out. |
| **Image / Video / Audio / File** | Upload via the toolbar, drag files from your desktop, or paste images. **GIFs and WebPs copied or dragged from a website stay animated** (the original file is fetched, not the still frame the browser puts on the clipboard), and pasted image/GIF links or Giphy/Tenor pages become images instead of link cards. Audio gets an inline player, video a native player, and PDFs and other files a download card. |
| **Line** | FigJam-style connector between two cards: elbow, curved or straight, solid or dashed, three thicknesses, any colour, arrows at none/one/both ends, and an optional label. |

## Projects and backgrounds

- **Projects** group boards like folders. The home page shows your projects (the ones you created or were invited to; admins see all), recently updated boards, and boards without a project. Open a project to see only its boards. Nested boards follow their parent's project.
- The **⋯** menu on a board tile moves it to another project, duplicates it (with the boards inside), changes its cover, or deletes it. Project tiles have a ⋯ menu too (cover, delete), and a project page has a **Cover** button. Covers can be any image in the project or a new upload; "automatic" uses the first image on its boards.
- **Trash:** deleting a board or project moves it (with the boards inside) to **Trash** in the sidebar for 30 days. Restore it from there (a board's card comes back on its parent board), or delete it forever. After 30 days it's deleted automatically.
- **Board background:** use the palette button in a board's top bar. Dark backgrounds (Graphite, Charcoal, Midnight, Forest) switch that board's cards and tools to dark grey. The choice is saved on the board, so everyone sees it.

## Using it

- **Toolbar:** a dock at the bottom of the board that magnifies under the pointer like the macOS Dock. Its **⋯** button moves it to the left, right or top (remembered per person).
- **Add cards:** click a toolbar item (it drops in a free spot) or drag it onto the canvas. Double-click empty canvas for a quick text card. Press **⇧A** for an add menu right at the cursor: type to filter, paste a link, or type text to make a note. Templates are listed there too.
- **Drag a line into empty space:** the same menu opens there, and the new card is connected to the line.
- **Templates (core team):** select cards (a group, table, to-do list, note, or a mix) and click the template button in the selection bar. Templates are filed by type (Groups, Tables, To-do lists, Notes, Layouts) in the ⇧A menu, where they can also be deleted.
- **Duplicate by dragging:** hold **Alt/Option** while dragging cards to drag a copy. A board card gets a real copy of its board.
- **Assets:** the **Assets** (folder) button in the toolbar lists every file uploaded or pasted onto the board, including ones whose cards were deleted, or for the whole project. Click or drag one to add it again. Rename files there (pencil on hover) or from a selected card's **Rename** button.
- **Notes:** the notes button in the top bar opens the board's scratchpad on the right, in the same column as Comments (switch with the tabs). Shared live with everyone who can edit the board, never shown to clients or viewers. Drag a note onto the board to make it a card.
- **Paste anything:** a URL makes a link card, an image uploads (GIFs stay animated), and plain text makes a note.
- **Connect:** select a card and drag any of the four dots (top, right, bottom, left) onto another card. Drop near an edge to attach to that side, or near the middle to let the line pick the best side. The **Line** tool (click two cards) also works.
- **Edit a line:** click it to open its toolbar (colour, thickness, text, dash, line type, arrows). Drag the end circles to re-attach them to another card or side. On elbow lines, every segment has a blue handle: the middle one moves the bend, and the end segments slide along their card (or step out past its edge). Double-click a handle to reset it.
- **Select (like Figma):** drag on empty canvas to box-select. Shift-drag or shift-click adds to the selection.
- **Navigate:** hold **Space** and drag, or drag with the **middle mouse button**, to pan. Scrolling with a trackpad or wheel also pans. ⌘/Ctrl + scroll or pinch to zoom. ⇧1 fits the board to the screen.
- **Resize:** select a card and drag either side edge or the corner. Hold **K** or **⌥** while resizing to scale the text with the box (on a group: the text of everything inside it; in a free group the cards' sizes and places too). Images, videos and links also have S/M/L/XL sizes in the selection bar.
- **Text size:** notes, headings, to-dos and tables have a size box in the selection bar, like Google Docs: type any size, use − / +, or pick a preset. While editing a note, select some words and use the same box to size just those words.
- **Rotate:** select a card and drag just outside any corner (the cursor turns into a rotate arrow). Hold **⇧** for 15° steps; it also clicks to straight angles. The angle shows in the selection bar; click it to straighten.
- **Images and videos:** **Crop** (drag the frame or its edges; Done, Enter or Esc applies, Cancel discards, *Full* shows everything), **Rotate 90°**, **Flip** horizontally or vertically, and **Reset**. Cropped videos play and pause on click.
- **Snapping (smart guides):** while moving cards, they line up with other cards' edges and centres and match the spacing between neighbours, with pink guides. Hold **⇧** to move straight across or up and down, hold **⌘/Ctrl** to skip snapping for that move, or switch snapping off with the magnet button by the zoom controls. Resizing snaps the edge too.
- **Copy between boards:** ⌘C / ⌘V copies cards, including the lines between them, into any board.

| Shortcut | Action |
| --- | --- |
| ⌘Z / ⇧⌘Z | Undo / redo |
| Space + drag / middle-drag | Pan |
| ⌘D / Alt-drag | Duplicate |
| ⇧ while dragging | Move straight (horizontal or vertical) |
| ⌘/Ctrl while dragging | Don't snap this move |
| K or ⌥ while resizing | Scale the text with the box |
| ⇧ while rotating | 15° steps |
| ⌘G / ⇧⌘G | Group / ungroup |
| ⇧A | Add menu at the cursor |
| M | Comment mode |
| ⌘A | Select all |
| Delete / Backspace | Delete selection |
| Arrows (⇧ for 10px) | Nudge |
| Enter | Edit selected card |
| N, H, L, T, B, C | New text, heading, link, to-do, board, line |
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
| `SESSION_SECRET` | *(generated)* | Signs link visitors' cookies and connector consent forms. If unset, a random secret is created once in `DATA_DIR/secret`. |
| `MCP_URL` | *(SHARE_URL)* | Optional: a different address for the Claude connector. It must not be behind Cloudflare Access. |
| `ANTHROPIC_API_KEY` | | Turns on **Claude in boards** (the Claude panel). A secret: set it in the host's variables, never commit it. Who may use it and the monthly cap are set on the Admin page. |
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
| **Admin** | `ADMIN_EMAILS` (default `admin@littleunusual.com`), plus anyone promoted | **Sees every project and board**, plus the **Admin** page: people, roles, inactivity settings |
| **Core team** | Anyone with an email in `TEAM_DOMAINS` (default `littleunusual.co`, `littleunusual.com`), plus anyone added on the Admin page | Create projects and boards, use templates. Sees **only the projects and boards they created or were invited to**. As an **editor** they can also share, rename, cover, move and delete them |
| **Guest** | Everyone else (freelancers, clients) | Only the projects and boards they're invited to, as **editor**, **commenter** or **viewer** (guest editors can't share or delete) |
| **Link visitor** | Anyone who opens a share link (no sign-in) | Only the shared board and the boards inside it, as **viewer** or **commenter** |

- **Projects are private by default:** whoever creates a project (or a board outside any project) is its first editor, and nobody else on the team sees it until they're invited. Invite teammates from **Share** the same way as guests. Projects from before this rule have no creator and are admin-only until an admin shares them.
- **Sharing one board:** open the board and click **Share** (the board's team editors and admins). Invite people by email to just that board (and the boards inside it), or turn on the link.
- **Share links:** *Anyone with the link can view* or *…can comment*. No sign-in or email invite is needed: visitors type their name and email (the team can turn that off for view-only links; commenting always asks). They're remembered on that device, and entering the same email on another device brings back their comments. They can comment, reply, resolve, and edit or delete their own comments; the **Comments** panel lists every thread, with an *Only yours* filter. Editing always needs an email invite. **Reset link** makes a new link and stops the old one; switching the link off removes access straight away, even for people who have it open. Visitors' names and emails aren't verified, so a link is for review, not for anything confidential. The Admin page lists everyone who has opened a link.
- **Inviting to a project:** open a project and click **Share**. Enter emails (teammates or guests) and pick *Can edit / Can comment / Can view*. Guests sign in with a one-time code; everyone sees only the projects they're in. Removing someone takes effect immediately, even if they have the board open.
- **Commenters** can pin comments, reply, resolve threads, and edit or delete their own comments. They can't change cards. **Editors** can also delete anyone's comments. **Viewers** can read comments but not add them.
- **Inactive guests** lose their project and board access after the period set on the Admin page (default 60 days). Invites that were never used are removed too. The core team is never removed.
- **Enforcement:** the server applies every rule to boards, files, uploads, live updates, board lists, Trash and the Claude connector. Nobody but an admin can reach another project's boards or files by guessing links.
- For invites to work without editing Cloudflare each time, the Cloudflare Access policy should let anyone sign in with a one-time PIN. The app then decides what each person can see.

### Claude in boards

A **Claude** tab beside every board (the ✦ button in the top bar), for the people the Admin page allows. Claude works on the board as the person chatting, with their access (a viewer's Claude can read but not change anything), and its changes show up live, signed "Name (via Claude)".

- **Ask and build:** Claude reads the board and its images, searches the web, and adds cards, groups, tables, long text (blog posts, scripts, briefs) and comments. Replies can also be put on the board with **+ Add to board**. **Stop** halts it; closing the page doesn't (the work is saved).
- **Context:** research Claude reads with the board, listed at the top of the panel: paste text, or upload Markdown, text, CSV, JSON, HTML or PDF files. Boards inside a board see its context too. From your own Claude chats, the connector saves research here (`add_context`, or `create_board` with `context`), so a board made from research keeps everything Claude found.
- **Chats** are saved per board and visible to everyone on the board who can use Claude.
- **Admin page → Claude in boards:** who can use it (everyone on the core team, or listed people; admins always), the **monthly cap** (default $50; Claude stops when it's reached), and this month's spending per person.
- **How it works:** `server/agent.js` runs Claude Opus 5.5 through the Anthropic API with the connector's tools (`server/mcp.js`) plus web search and fetch, streaming to the browser. Each chat keeps its system prompt (instructions and the board's context) fixed; context added later arrives as a system message, so history is only ever appended to. Costs are estimated from token usage at list prices into `DATA_DIR/ai-usage.json`; chats live in `DATA_DIR/ai/<board>.json`. Test without a key: `node scripts/fake-anthropic.mjs 4040` and start the app with `ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4040`.

### Claude connector (MCP)

Claude (claude.ai, the desktop app, Claude Code) and other apps that support MCP connectors can read and build boards. Each person connects their own Claude and it works **as them**: the same projects, boards and permissions they have in the app (a commenter's Claude can comment but not edit; a guest's Claude only sees their boards).

- **Connect:** in Claude, open *Settings → Connectors → Add custom connector* and paste the connector address shown on the Admin page (e.g. `https://share.littleunusual.xyz/mcp`). Claude opens the Reference Board sign-in (the usual Cloudflare login) and a consent page; click **Allow**. On a Team or Enterprise plan an owner can add it once for everyone. Claude Code: `claude mcp add --transport http reference-board https://share.littleunusual.xyz/mcp`.
- **What Claude can do:** list projects and boards, search, read a board (cards, lines, comments, sub-boards, notes for editors), **look at a board's images** (`view_images`: small previews of image and GIF cards and link preview pictures, 8 per call, so it can recognise what they show even when the files have meaningless names), create boards, add cards (text, headings, labels, links/embeds, images and GIFs from the web, videos, to-dos, tables, groups with cards inside), update, arrange and connect cards, delete cards (Claude asks first), comment and resolve, add board notes, and **keep research as board context** (`add_context`, `list_context`, `read_context`; `create_board` takes `context` too). Ask Claude to "make a board from this research" and it saves the full research with the board, for Claude in the app to build on. It can't delete boards or projects, or change sharing.
- **Live:** changes appear for everyone with the board open, signed "Name (via Claude)".
- **Admin:** the Admin page shows the connector address, setup warnings, and who has connected which app, with **Disconnect**. Removing a person also disconnects their apps.
- **Setup:** the connector lives at `SHARE_URL` (or `MCP_URL`), which must not be behind Cloudflare Access, because Claude's servers call it. Sign-in happens on `PUBLIC_URL`, behind Access. Both must be set in Cloudflare mode.
- **How it works:** MCP over Streamable HTTP (`/mcp`, JSON responses), OAuth 2.1 with PKCE, dynamic client registration and client ID metadata documents (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/*`). Tokens last an hour and refresh for 60 days; only their hashes are stored (`DATA_DIR/oauth.json`).

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
  importer.js   fetches pasted/dropped web media (keeps GIFs animated)
  templates.js  saved templates (templates.json)
  oauth.js      OAuth 2.1 for the Claude connector (registration, consent, tokens)
  mcp.js        the MCP server: tools Claude uses to read and build boards
  thumbs.js     small JPEG previews of board images for the connector (pure JS, cached in DATA_DIR/thumbs)
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
