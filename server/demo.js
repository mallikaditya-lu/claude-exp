import crypto from 'node:crypto';
import { writeDemoAssets } from './demo-assets.js';

// A large, realistic demo project that exercises every feature: nested boards, every card type,
// columns, all connector styles, comments from several people and dark/light backgrounds.

export const DEMO_PROJECT_NAME = 'Demo · Aurora Summit launch campaign';

const uuid = () => crypto.randomUUID();
const HOUR = 3600 * 1000;
const P = {
  maya: 'Maya Chen',
  jon: 'Jon Ade',
  priya: 'Priya Nair',
  leo: 'Leo Park',
  sam: 'Sam Ortiz',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');
const ul = (...items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const ol = (...items) => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
const b = (s) => `<b>${s}</b>`;
const a = (href, text) => `<a href="${href}">${esc(text)}</a>`;

const YT = (id) => `https://www.youtube.com/watch?v=${id}`;
const PICSUM = (id) => `https://picsum.photos/id/${id}/1200/800`;
const MDN_FLOWER = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const BBB_MP4 = 'https://www.w3schools.com/html/mov_bbb.mp4';

function builder() {
  let z = 0;
  const items = {};
  const connections = {};
  const add = (item) => {
    const it = { id: uuid(), z: ++z, w: 260, createdAt: Date.now() - 72 * HOUR, createdBy: P.maya, ...item };
    items[it.id] = it;
    return it.id;
  };
  const column = (col, children) => {
    const cid = add({ type: 'column', w: 320, ...col, childIds: [] });
    items[cid].childIds = children.map((c) => add({ x: 0, y: 0, ...c, parentId: cid }));
    return cid;
  };
  const line = (from, to, opts = {}) => {
    const id = uuid();
    connections[id] = { id, from, to, shape: 'elbow', ...opts };
    return id;
  };
  const todos = (...list) => list.map((t) => (Array.isArray(t) ? { id: uuid(), text: t[0], done: t[1] } : { id: uuid(), text: t, done: false }));
  const comments = (...list) => list.map(([author, text, hoursAgo]) => ({ id: uuid(), author, text, at: Date.now() - hoursAgo * HOUR }));
  const save = (store, boardId, background = null) =>
    store.applyPatch(boardId, { background, upsertItems: Object.values(items), upsertConnections: Object.values(connections) });
  return { add, column, line, todos, comments, save };
}

export function seedDemoProject(store, uploadDir) {
  const A = writeDemoAssets(uploadDir);
  const media = (key, extra = {}) => ({ url: A[key].url, fileName: A[key].fileName, size: A[key].size, mime: A[key].mime, ...extra });

  const project = store.createProject({ name: DEMO_PROJECT_NAME, color: 'teal' });
  const hub = store.create({ title: 'Aurora Summit 2026 — Campaign hub', projectId: project.id });
  const sub = (title) => store.create({ title, parentId: hub.id });
  const research = sub('01 · Research & references');
  const mood = sub('02 · Moodboard — “Light after dark”');
  const script = sub('03 · Script & storyboard');
  const music = sub('04 · Music & sound');
  const shoot = sub('05 · Shoot plan — Lisbon');
  const post = sub('06 · Post-production & delivery');
  const feedback = store.create({ title: 'Client feedback — rough cut v1', parentId: post.id });
  const wiki = store.create({ title: 'Team wiki — how we work', projectId: project.id });
  const archive = store.create({ title: 'Archive · Summit 2025 recap film', projectId: project.id });

  // =====================================================================
  // HUB
  // =====================================================================
  {
    const B = builder();
    const title = B.add({ type: 'heading', x: 620, y: 0, w: 460, text: 'Aurora Summit 2026 · Launch campaign', color: 'red' });
    B.add({ type: 'image', x: 1180, y: -70, w: 330, ...media('logo'), caption: 'Logo lockup — final, approved 12 Jan' });
    B.add({
      type: 'note', x: -420, y: -40, w: 340, color: 'yellow',
      text: p(b('👋 Start here')) + ul(
        'This hub holds the brief, deliverables, timeline and team.',
        'The <b>Workstreams</b> row at the bottom opens a board per phase — double-click one.',
        'Lines show how things depend on each other. Click a line to restyle it.',
        'Background, colours and comments are all shared live with the team.',
      ),
    });

    const hBrief = B.add({ type: 'heading', x: 80, y: 150, w: 260, text: 'The brief', color: 'purple' });
    const hDeliv = B.add({ type: 'heading', x: 700, y: 150, w: 260, text: 'Deliverables', color: 'purple' });
    const hTime = B.add({ type: 'heading', x: 1200, y: 150, w: 260, text: 'Timeline', color: 'purple' });
    const hTeam = B.add({ type: 'heading', x: 1640, y: 150, w: 260, text: 'Team & comms', color: 'purple' });
    [hBrief, hDeliv, hTime, hTeam].forEach((h) => B.line(title, h, { weight: 2 }));

    const brief = B.add({
      type: 'note', x: 0, y: 240, w: 420,
      text: p(b('Client:') + ' Aurora Summit (3rd edition) · Lisbon · 26–28 March 2026') +
        p('A 60-second hero film and cut-downs that make builders feel they <i>can’t</i> miss this year. Last year’s recap was informative but flat — this year we lead with ' + b('emotion first, logistics second') + '.') +
        p(b('Budget:') + ' €64k all-in · ' + b('Launch:') + ' 12 March with ticket release'),
    });
    const audience = B.add({
      type: 'note', x: 0, y: 540, w: 420,
      text: '<h2>Audience</h2>' + ul('Founders and early engineers (25–40)', 'Investors scouting the next cohort', 'Returning attendees — 38% of 2025 tickets'),
    });
    const message = B.add({
      type: 'note', x: 0, y: 760, w: 420, color: 'green',
      text: p(b('Key message')) + p('“Where the next decade of builders meets.” Every cut should end on the people, not the stage.'),
    });
    B.line(hBrief, brief);
    B.line(brief, audience, { shape: 'straight', arrow: 'none', dash: true });
    B.line(audience, message, { shape: 'straight', arrow: 'none', dash: true });

    const deliv = B.add({
      type: 'table', x: 520, y: 240, w: 620, title: 'Deliverables v4',
      table: [
        ['Deliverable', 'Format', 'Length', 'Owner', 'Due'],
        ['Hero film', '16:9 · 4K', '60s', 'Jon', '10 Mar'],
        ['Social cut-down', '9:16', '15s', 'Leo', '10 Mar'],
        ['Social cut-down', '1:1', '30s', 'Leo', '11 Mar'],
        ['Speaker teasers ×6', '9:16', '10s each', 'Leo', '14 Mar'],
        ['Stills for press kit', 'JPG', '20 frames', 'Maya', '11 Mar'],
        ['On-site screens loop', '32:9 LED', '90s', 'Sam', '20 Mar'],
      ],
    });
    const signoff = B.add({
      type: 'todo', x: 520, y: 640, w: 620, title: 'Client sign-offs', color: 'blue',
      todos: B.todos(['Brief & budget', true], ['Treatment + moodboard', true], ['Script v3', true], 'Rough cut v1', 'Fine cut + music', 'Final delivery & captions'),
    });
    B.line(hDeliv, deliv);
    B.line(deliv, signoff, { shape: 'straight', label: 'gates' });

    const timeline = B.column({ x: 1180, y: 240, w: 320, title: 'Timeline', color: 'teal' }, [
      { type: 'note', text: p(b('Wk 1–2 · Research')) + p('Reference films, audience interviews, moodboard') },
      { type: 'note', text: p(b('Wk 3 · Script & boards')) + p('Script v1 → v3, storyboard, music temp') },
      { type: 'note', color: 'orange', text: p(b('Wk 4 · Shoot')) + p('2 days in Lisbon · 26–27 Feb') },
      { type: 'note', text: p(b('Wk 5–6 · Post')) + p('Edit, colour, sound, 2 feedback rounds') },
      { type: 'note', color: 'green', text: p(b('12 Mar · Launch 🚀')) + p('Ticket release + hero film premiere') },
    ]);
    B.line(hTime, timeline);

    const team = B.add({
      type: 'table', x: 1600, y: 240, w: 400, title: 'Who’s who',
      table: [
        ['Name', 'Role'],
        ['Maya Chen', 'Producer'],
        ['Jon Ade', 'Director'],
        ['Leo Park', 'Editor'],
        ['Sam Ortiz', 'Sound & music'],
        ['Priya Nair', 'Client · Aurora marketing'],
      ],
    });
    const thread = B.add({
      type: 'comment', x: 1600, y: 560, w: 400,
      comments: B.comments(
        [P.priya, 'Loving the direction. Can we make sure Lisbon itself is a character, not just the venue?', 50],
        [P.jon, 'Yes — added a dawn aerial and a rooftop walk-and-talk on day 2.', 47],
        [P.maya, 'Drone permit for the river approved ✅', 30],
      ),
    });
    B.line(hTeam, team);
    B.line(team, thread, { shape: 'straight', arrow: 'none', dash: true });

    // Workstreams row
    const hWork = B.add({ type: 'heading', x: 760, y: 1040, w: 320, text: 'Workstreams', color: 'blue' });
    B.line(message, hWork, { dash: true, color: 'green', label: 'everything ladders up to this', fromSide: 'right', toSide: 'left' });
    const boards = [
      [research, 'orange'], [mood, 'purple'], [script, 'blue'], [music, 'pink'], [shoot, 'teal'], [post, 'green'],
    ];
    boards.forEach(([bd, color], i) => {
      const card = B.add({ type: 'board', x: 220 + i * 250, y: 1150, w: 190, boardId: bd.id, color });
      B.line(hWork, card, { color: 'blue' });
    });
    B.save(store, hub.id);
  }

  // =====================================================================
  // 01 RESEARCH (warm)
  // =====================================================================
  {
    const B = builder();
    const title = B.add({ type: 'heading', x: 560, y: 0, w: 380, text: 'Research & references', color: 'orange' });
    const hFilms = B.add({ type: 'heading', x: 120, y: 120, w: 260, text: 'Reference films', color: 'purple' });
    const hAud = B.add({ type: 'heading', x: 820, y: 120, w: 280, text: 'What the audience says', color: 'purple' });
    const hRead = B.add({ type: 'heading', x: 1400, y: 120, w: 260, text: 'Reading list', color: 'purple' });
    [hFilms, hAud, hRead].forEach((h) => B.line(title, h));

    const films = B.column({ x: 0, y: 210, w: 360, title: 'Tone & storytelling', color: 'purple' }, [
      { type: 'link', url: YT('eRsGyueVLvQ'), title: 'Sintel — Blender open movie', siteName: 'YouTube' },
      { type: 'note', text: p(b('Why:') + ' emotional arc in under a minute of screen time; the music carries the cut.') },
      { type: 'link', url: YT('R6MlUcmOul8'), title: 'Tears of Steel', siteName: 'YouTube' },
    ]);
    const pacing = B.column({ x: 400, y: 210, w: 340, title: 'Motion & pacing', color: 'teal' }, [
      { type: 'link', url: 'https://vimeo.com/1084537', title: 'Big Buck Bunny', siteName: 'Vimeo' },
      { type: 'link', url: YT('WhWc3b3KhnY'), title: 'Spring', siteName: 'YouTube' },
      { type: 'note', color: 'teal', text: p('Cut on motion. Average shot length ~1.8s in the build, then let the last shot breathe for 4s.') },
    ]);
    B.line(hFilms, films);
    B.line(hFilms, pacing);

    const survey = B.add({
      type: 'table', x: 800, y: 210, w: 520, title: 'Post-event survey 2025 (n = 412)',
      table: [
        ['Question', 'Top answer', '%'],
        ['Why did you come?', 'Meet other builders', '61%'],
        ['Best moment', 'Hallway conversations', '44%'],
        ['What was missing?', 'More small-group sessions', '37%'],
        ['Would you return?', 'Yes, definitely', '82%'],
      ],
    });
    const ins1 = B.add({ type: 'note', x: 800, y: 520, w: 240, color: 'yellow', text: p(b('Insight')) + p('People come for each other, not the stage. Film the in-between moments.') });
    const ins2 = B.add({ type: 'note', x: 1080, y: 520, w: 240, color: 'pink', text: p(b('Insight')) + p('Returning attendees are our best ambassadors — interview three of them.') });
    B.line(hAud, survey);
    B.line(survey, ins1, { shape: 'curved', dash: true, label: 'insight', color: 'orange' });
    B.line(survey, ins2, { shape: 'curved', dash: true, label: 'insight', color: 'orange' });

    const reading = B.column({ x: 1380, y: 210, w: 320, title: 'Articles & inspiration', color: 'orange' }, [
      { type: 'link', url: 'https://en.wikipedia.org/wiki/Aurora', title: 'Aurora — Wikipedia' },
      { type: 'link', url: 'https://www.awwwards.com/', title: 'Awwwards — site of the day' },
      { type: 'link', url: 'https://www.behance.net/search/projects?search=event%20identity', title: 'Behance — event identities' },
      { type: 'note', text: p('Paste any link here and it becomes a preview card automatically.') },
    ]);
    B.line(hRead, reading);

    const hVis = B.add({ type: 'heading', x: 120, y: 980, w: 260, text: 'Visual research', color: 'purple' });
    const photos = [[1015, 'River light at dawn'], [1036, 'Scale — people vs. landscape'], [1043, 'Warm interiors'], [1067, 'City texture'], [1076, 'Quiet moments']];
    let prev = hVis;
    photos.forEach(([id, caption], i) => {
      const img = B.add({ type: 'image', x: i * 300, y: 1060, w: 280, url: PICSUM(id), fileName: `reference-${id}.jpg`, caption });
      if (i === 0) B.line(prev, img);
      prev = img;
    });
    B.add({
      type: 'comment', x: 1540, y: 1040, w: 320,
      comments: B.comments(
        [P.jon, 'The river shot is exactly the palette for the opening.', 60],
        [P.priya, 'Agree. Can we avoid anything that looks like stock footage?', 58],
        [P.jon, 'Yes — all of this is reference only; we shoot everything ourselves.', 57],
      ),
    });
    B.save(store, research.id, 'warm');
  }

  // =====================================================================
  // 02 MOODBOARD (charcoal / dark)
  // =====================================================================
  {
    const B = builder();
    B.add({ type: 'heading', x: 420, y: -10, w: 460, text: 'Moodboard — “Light after dark”', color: 'purple' });
    B.add({ type: 'image', x: 0, y: 80, w: 540, ...media('aurora1'), caption: 'Hero look: deep night, colour arrives with the people' });
    B.add({ type: 'image', x: 580, y: 80, w: 270, url: PICSUM(1081), fileName: 'ref-1081.jpg' });
    B.add({ type: 'image', x: 870, y: 80, w: 270, url: PICSUM(164), fileName: 'ref-164.jpg' });
    B.add({ type: 'image', x: 580, y: 280, w: 270, ...media('aurora2') });
    B.add({ type: 'image', x: 870, y: 280, w: 270, ...media('aurora3') });
    const pal = B.add({ type: 'image', x: 0, y: 440, w: 540, ...media('palette'), caption: 'Palette' });
    const spec = B.add({ type: 'image', x: 580, y: 470, w: 560, ...media('type'), caption: 'Type pairing' });
    B.add({ type: 'video', x: 1190, y: 80, w: 380, url: MDN_FLOWER, fileName: 'Texture test — macro bloom.mp4', size: 554058 });
    B.add({ type: 'video', x: 1190, y: 400, w: 380, url: BBB_MP4, fileName: 'Motion reference — character energy.mp4', size: 788493 });
    const cNote = B.add({ type: 'note', x: 0, y: 760, w: 250, color: 'purple', text: p(b('Colour')) + p('Night sky base, violet and teal as “light”. Green only for the final aurora beat.') });
    const lNote = B.add({ type: 'note', x: 290, y: 760, w: 250, text: p(b('Light')) + p('Practical light only indoors. Haze in the keynote hall, flares allowed.') });
    const tNote = B.add({ type: 'note', x: 580, y: 850, w: 280, color: 'teal', text: p(b('Type')) + p('Serif headline for warmth, sans for everything functional.') });
    B.line(cNote, pal, { shape: 'straight', label: 'hex values', color: 'purple' });
    B.line(tNote, spec, { shape: 'straight', label: 'specimen', color: 'teal' });
    B.add({
      type: 'table', x: 1190, y: 740, w: 380, title: 'Do / Don’t',
      table: [['Do', 'Don’t'], ['Faces, hands, eye contact', 'Empty stages'], ['Real reactions', 'Posed thumbs-up'], ['Lisbon light', 'Generic skyline stock'], ['Let shots breathe', 'Whip-pan everything']],
    });
    B.save(store, mood.id, 'charcoal');
  }

  // =====================================================================
  // 03 SCRIPT & STORYBOARD
  // =====================================================================
  {
    const B = builder();
    B.add({ type: 'heading', x: 260, y: 0, w: 420, text: 'Script v3 — 60s hero film', color: 'red' });
    const tbl = B.add({
      type: 'table', x: 0, y: 90, w: 940, title: 'Script v3 (approved)',
      table: [
        ['#', 'Time', 'Picture', 'Voiceover', 'Sound'],
        ['1', '00:00–00:06', 'Aerial: Lisbon at dawn, river mist, venue roof catches first light.', '—', 'Low drone, birds, distant tram'],
        ['2', '00:06–00:14', 'Doors open. Crowd arrives: badges, coffee, first handshakes.', 'VO: “Every year, something starts here.”', 'Music enters — soft pad'],
        ['3', '00:14–00:22', 'Keynote hall. Haze. Speaker steps into light; audience leans in.', 'VO: “Not on the stage…”', 'Room goes quiet, one breath'],
        ['4', '00:22–00:30', 'Close-ups: hands on laptops, lanyards, notebooks, a laugh.', 'VO: “…but in the conversations after.”', 'Music builds, pulse enters'],
        ['5', '00:30–00:42', 'Workshop room: whiteboard fills with ideas; montage of small groups.', '—', 'Music peak, natural sound up'],
        ['6', '00:42–00:52', 'Rooftop at dusk: two founders mid-conversation, city behind.', 'VO: “Where the next decade of builders meets.”', 'Music resolves'],
        ['7', '00:52–01:00', 'Night: aurora-style light over the venue. Logo + date.', 'VO: “Aurora Summit. 26–28 March, Lisbon.”', 'Final chord, ring out'],
      ],
    });
    B.add({
      type: 'todo', x: 0, y: 820, w: 440, title: 'Script notes to action', color: 'yellow',
      todos: B.todos(['Shorten VO in scene 3', true], ['Check Portuguese title card', true], 'Confirm rooftop permission (scene 6)', 'Lock end-card wording with legal'),
    });
    const fb = B.add({
      type: 'comment', x: 500, y: 820, w: 440, color: 'pink',
      comments: B.comments(
        [P.priya, 'Scene 3 VO feels a bit on the nose — could the room sound do that work?', 30],
        [P.jon, 'Good call. We’ll try it silent in the edit and keep the line as backup.', 28],
      ),
    });
    B.line(fb, tbl, { shape: 'curved', dash: true, color: 'red', label: 'client note → scene 3', toSide: 'bottom', fromSide: 'top' });

    B.add({ type: 'heading', x: 1270, y: 0, w: 340, text: 'Storyboard', color: 'blue' });
    const frames = [];
    for (let i = 0; i < 6; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      frames.push(B.add({ type: 'image', x: 1040 + col * 460, y: 90 + row * 320, w: 340, ...media(`frame${i + 1}`) }));
    }
    const labels = ['cut', 'match cut', 'cut on motion', 'dissolve', 'slow push-in'];
    for (let i = 0; i < 5; i++) {
      B.line(frames[i], frames[i + 1], { label: labels[i], color: 'blue', weight: 2 });
    }
    B.save(store, script.id);
  }

  // =====================================================================
  // 04 MUSIC & SOUND (midnight / dark)
  // =====================================================================
  {
    const B = builder();
    const title = B.add({ type: 'heading', x: 520, y: 0, w: 360, text: 'Music & sound', color: 'pink' });
    const hTemp = B.add({ type: 'heading', x: 40, y: 110, w: 280, text: 'Temp tracks (reference)', color: 'purple' });
    const hDemo = B.add({ type: 'heading', x: 600, y: 110, w: 280, text: 'Composer demos', color: 'purple' });
    const hDec = B.add({ type: 'heading', x: 1160, y: 110, w: 280, text: 'Decision', color: 'purple' });
    [hTemp, hDemo, hDec].forEach((h) => B.line(title, h));

    const temp = B.column({ x: 0, y: 190, w: 380, title: 'Temp playlist', color: 'pink' }, [
      { type: 'link', url: 'https://open.spotify.com/track/6ZFbXIJkuI1dVNWvzJzown', title: 'Time — Hans Zimmer', siteName: 'Spotify' },
      { type: 'link', url: 'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV', title: 'One More Time — Daft Punk', siteName: 'Spotify' },
      { type: 'link', url: 'https://soundcloud.com/forss/flickermood', title: 'Flickermood — Forss', siteName: 'SoundCloud' },
      { type: 'note', text: p(b('Temp only — not licensable.')) + p('Use for tone and tempo. Target ~96 BPM, build from 00:22.') },
    ]);
    B.line(hTemp, temp);

    const optA = B.add({ type: 'audio', x: 580, y: 190, w: 340, ...media('track1'), createdBy: P.sam });
    const optB = B.add({ type: 'audio', x: 580, y: 330, w: 340, ...media('track2'), createdBy: P.sam });
    const tone = B.add({ type: 'audio', x: 580, y: 470, w: 340, ...media('track3'), createdBy: P.sam });
    B.line(hDemo, optA);
    B.line(optA, optB, { shape: 'straight', arrow: 'none', dash: true });
    B.line(optB, tone, { shape: 'straight', arrow: 'none', dash: true });
    B.add({
      type: 'table', x: 560, y: 630, w: 520, title: 'Licensing & cost',
      table: [['Option', 'Type', 'Cost', 'Usage'], ['A — ambient pad', 'Bespoke composer', '€6,000', 'Perpetual, all media'], ['B — pulse', 'Bespoke composer', '€5,200', 'Perpetual, all media'], ['Library alt.', 'Stock licence', '€900', '1 year, online only']],
    });

    const playlist = B.add({ type: 'link', x: 1140, y: 190, w: 360, url: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ', title: 'Deep Focus', siteName: 'Spotify' });
    B.line(hDec, playlist, { arrow: 'none', dash: true });
    const decision = B.add({ type: 'note', x: 1140, y: 640, w: 360, color: 'green', text: p(b('✅ Going with option A')) + p('Warmer, leaves room for VO. Composer to add a lift at 00:30 and a clean ending on the logo.') });
    B.line(optA, decision, { color: 'green', weight: 3, label: 'chosen', fromSide: 'right', toSide: 'left' });
    B.line(optB, decision, { dash: true, label: 'backup', fromSide: 'right', toSide: 'left', arrow: 'none' });
    B.add({
      type: 'comment', x: 1140, y: 860, w: 360,
      comments: B.comments([P.sam, 'Uploaded both demos — A is at 96 BPM, B at 110.', 20], [P.priya, 'A all the way. Goosebumps at the end!', 12]),
    });
    B.save(store, music.id, 'midnight');
  }

  // =====================================================================
  // 05 SHOOT PLAN (mint)
  // =====================================================================
  {
    const B = builder();
    const title = B.add({ type: 'heading', x: 420, y: 0, w: 420, text: 'Shoot — 2 days in Lisbon', color: 'teal' });
    const call = B.add({
      type: 'table', x: 0, y: 100, w: 640, title: 'Call sheet — overview',
      table: [
        ['Day', 'Time', 'Scene', 'Location'],
        ['Thu 26', '07:00', '1 · Aerial dawn', 'River + Congress Centre'],
        ['Thu 26', '08:30', '2 · Arrivals', 'Main hall'],
        ['Thu 26', '10:00', '3 · Keynote', 'Auditorium A'],
        ['Thu 26', '15:00', '5 · Workshop', 'Room 2.1'],
        ['Fri 27', '17:30', '6 · Rooftop', 'Hotel Memmo terrace'],
        ['Fri 27', '21:00', '7 · Night / light', 'Venue exterior'],
      ],
    });
    B.line(title, call);
    const files = B.column({ x: 1460, y: 100, w: 320, title: 'Documents', color: 'default' }, [
      { type: 'file', ...media('callsheet') },
      { type: 'file', ...media('budget') },
      { type: 'link', url: 'https://www.google.com/maps/search/Lisbon+Congress+Centre', title: 'Lisbon Congress Centre — map', siteName: 'Google Maps' },
    ]);

    const day1 = B.column({ x: 720, y: 100, w: 320, title: 'Day 1 · Congress Centre', color: 'teal' }, [
      { type: 'todo', title: 'Shot list', todos: B.todos(['Drone: river approach', true], ['Drone: roof reveal', true], 'Badge desk wide + tight', 'Keynote: haze + backlight', 'Workshop whiteboard timelapse') },
      { type: 'image', url: PICSUM(180), fileName: 'recce-hall.jpg', caption: 'Recce: main hall, north doors' },
    ]);
    const day2 = B.column({ x: 1090, y: 100, w: 320, title: 'Day 2 · Rooftop & streets', color: 'blue' }, [
      { type: 'todo', title: 'Shot list', todos: B.todos('Rooftop walk-and-talk (2 founders)', 'Tram pass — golden hour', 'Night exterior with light rig') },
      { type: 'image', url: PICSUM(225), fileName: 'recce-rooftop.jpg', caption: 'Recce: rooftop, west view' },
      { type: 'note', color: 'orange', text: p(b('⚠️ Weather backup')) + p('If rain: move scene 6 to the hotel lobby, keep the window light.') },
    ]);
    B.line(call, day1, { label: 'Day 1', color: 'teal', weight: 2, fromSide: 'right', toSide: 'left', fromShift: -90, toShift: -110 });
    B.line(call, day2, { label: 'Day 2', color: 'blue', weight: 2, fromSide: 'bottom', toSide: 'bottom', bend: 1.25 });
    B.line(title, files, { dash: true, arrow: 'none', color: 'teal', fromSide: 'right', toSide: 'top' });

    B.add({
      type: 'todo', x: 0, y: 680, w: 300, title: 'Kit list', color: 'yellow',
      todos: B.todos(['2× cinema camera + primes', true], ['Drone + ND filters', true], ['Haze machine', true], 'LED tubes ×8', 'Wireless lav ×4', 'Spare drives (4TB ×6)'),
    });
    B.add({
      type: 'table', x: 340, y: 680, w: 460, title: 'Contacts',
      table: [['Who', 'Role', 'Phone'], ['Maya Chen', 'Producer', '+351 912 000 111'], ['Jon Ade', 'Director', '+351 912 000 222'], ['Rita Sousa', 'Location manager', '+351 912 000 333'], ['Venue security', 'Access & parking', '+351 213 000 000']],
    });
    B.add({
      type: 'comment', x: 840, y: 760, w: 380,
      comments: B.comments([P.maya, 'Call sheet PDF is final — please download before Thursday.', 26], [P.jon, 'Thanks! Added the weather backup to Day 2.', 24]),
    });
    B.save(store, shoot.id, 'mint');
  }

  // =====================================================================
  // 06 POST-PRODUCTION (lilac) — kanban with columns
  // =====================================================================
  {
    const B = builder();
    B.add({ type: 'heading', x: 640, y: -10, w: 420, text: 'Post-production & delivery', color: 'green' });
    const cols = [
      B.column({ x: 0, y: 90, w: 300, title: 'Edit', color: 'blue' }, [
        { type: 'todo', title: 'Leo', todos: B.todos(['Assembly', true], ['Rough cut v1', true], 'Fine cut v2') },
        { type: 'note', text: p('Selects are in the shared drive: <b>/Aurora/02_Selects</b>') },
      ]),
      B.column({ x: 360, y: 90, w: 300, title: 'Colour & VFX', color: 'purple' }, [
        { type: 'note', text: p(b('Look:') + ' lift the blacks slightly, violet in the shadows, teal highlights.') },
        { type: 'image', ...media('aurora1'), caption: 'Grade target' },
      ]),
      B.column({ x: 720, y: 90, w: 300, title: 'Sound mix', color: 'pink' }, [
        { type: 'audio', ...media('track1') },
        { type: 'todo', title: 'Sam', todos: B.todos('Dialogue clean-up', 'Music edit to picture', 'Loudness: -14 LUFS web / -23 broadcast') },
      ]),
      B.column({ x: 1080, y: 90, w: 300, title: 'Review', color: 'orange' }, [
        { type: 'video', url: BBB_MP4, fileName: 'Aurora_hero_rough-cut_v1.mp4', size: 788493 },
        { type: 'note', color: 'orange', text: p('Round 1 feedback is in the board below ↓') },
      ]),
      B.column({ x: 1440, y: 90, w: 300, title: 'Delivered ✓', color: 'green' }, [
        { type: 'note', color: 'green', text: p(b('Stills for press kit')) + p('20 frames exported, sent 11 Mar') },
      ]),
    ];
    for (let i = 0; i < cols.length - 1; i++) B.line(cols[i], cols[i + 1], { weight: 2, fromSide: 'right', toSide: 'left', color: 'purple' });

    B.add({
      type: 'table', x: 0, y: 760, w: 760, title: 'Delivery specs',
      table: [['Version', 'Aspect', 'Resolution', 'Codec', 'Captions'], ['Hero master', '16:9', '3840×2160', 'ProRes 422 HQ', 'Burned-in + SRT'], ['Web hero', '16:9', '1920×1080', 'H.264 · 20 Mbps', 'SRT'], ['Social vertical', '9:16', '1080×1920', 'H.264', 'Burned-in'], ['LED loop', '32:9', '7680×2160', 'HAP', 'None']],
    });
    const fbCard = B.add({ type: 'board', x: 1120, y: 780, w: 200, boardId: feedback.id, color: 'orange' });
    B.line(cols[3], fbCard, { label: 'round 1', color: 'orange', dash: true });
    B.save(store, post.id, 'lilac');
  }

  // Nested 3 levels deep: feedback board (graphite / dark)
  {
    const B = builder();
    B.add({ type: 'heading', x: 200, y: -20, w: 420, text: 'Rough cut v1 — client feedback', color: 'orange' });
    const vid = B.add({ type: 'video', x: 0, y: 60, w: 620, url: BBB_MP4, fileName: 'Aurora_hero_rough-cut_v1.mp4', size: 788493 });
    const c1 = B.add({ type: 'comment', x: 720, y: 20, w: 320, comments: B.comments([P.priya, '00:04 — can we hold the aerial a beat longer? It’s beautiful.', 10], [P.leo, 'Done in v2 (+18 frames).', 6]) });
    const c2 = B.add({ type: 'comment', x: 720, y: 220, w: 320, comments: B.comments([P.priya, '00:31 — the crowd section feels rushed.', 9], [P.jon, 'We’ll swap two shots for the laughing table.', 7]) });
    const c3 = B.add({ type: 'comment', x: 720, y: 420, w: 320, comments: B.comments([P.priya, '00:55 — end card: add “Tickets on sale now”.', 9]) });
    B.line(c1, vid, { shape: 'straight', color: 'red', label: '00:04', fromSide: 'left' });
    B.line(c2, vid, { shape: 'straight', color: 'red', label: '00:31', fromSide: 'left' });
    B.line(c3, vid, { shape: 'straight', color: 'red', label: '00:55', fromSide: 'left' });
    B.add({
      type: 'todo', x: 0, y: 470, w: 620, title: 'Changes for v2', color: 'orange',
      todos: B.todos(['Hold aerial +18f', true], 'Swap crowd shots at 00:31', 'Add “Tickets on sale now” to end card', 'Re-time music lift to new cut'),
    });
    B.save(store, feedback.id, 'graphite');
  }

  // =====================================================================
  // TEAM WIKI (top-level board in the project)
  // =====================================================================
  {
    const B = builder();
    const t = B.add({ type: 'heading', x: 380, y: 0, w: 360, text: 'How we work', color: 'blue' });
    const n1 = B.add({ type: 'note', x: 0, y: 110, w: 340, text: '<h2>1 · One board per phase</h2>' + p('Research → Moodboard → Script → Music → Shoot → Post. The hub links them all.') });
    const n2 = B.add({ type: 'note', x: 380, y: 110, w: 340, text: '<h2>2 · Decisions live on the board</h2>' + p('Mark a decision with a ' + b('green note') + ' and connect it to the options it chose between.') });
    const n3 = B.add({ type: 'note', x: 760, y: 110, w: 340, text: '<h2>3 · Feedback as comments</h2>' + p('Clients pin comments straight onto the cut, and the team resolves them as changes land.') });
    [n1, n2, n3].forEach((n) => B.line(t, n, { color: 'blue' }));
    B.line(n1, n2, { shape: 'straight', arrow: 'none', dash: true });
    B.line(n2, n3, { shape: 'straight', arrow: 'none', dash: true });
    B.add({
      type: 'table', x: 0, y: 400, w: 520, title: 'Shortcuts cheat sheet',
      table: [['Action', 'Shortcut'], ['Pan', 'Space + drag / middle mouse'], ['Box select', 'Drag on empty canvas'], ['Zoom', '⌘ + scroll / pinch'], ['Fit board', '⇧ 1'], ['Duplicate', '⌘ D'], ['Undo / redo', '⌘ Z / ⇧ ⌘ Z'], ['New note', 'N (or double-click canvas)']],
    });
    B.add({
      type: 'todo', x: 560, y: 400, w: 300, title: 'Onboarding a new teammate', color: 'green',
      todos: B.todos(['Share the hub link', true], 'Set their display name', 'Walk through the hub (5 min)', 'Add them to the Team table'),
    });
    B.column({ x: 900, y: 400, w: 300, title: 'Useful tools', color: 'teal' }, [
      { type: 'link', url: 'https://fonts.google.com/specimen/Inter', title: 'Inter — Google Fonts' },
      { type: 'link', url: 'https://coolors.co/', title: 'Coolors — palette generator' },
    ]);
    B.save(store, wiki.id);
  }

  // =====================================================================
  // ARCHIVE (graphite)
  // =====================================================================
  {
    const B = builder();
    B.add({ type: 'heading', x: 160, y: 0, w: 380, text: 'Summit 2025 — recap film', color: 'default' });
    B.add({ type: 'link', x: 0, y: 90, w: 480, url: YT('Y-rmzh0PI3c'), title: '2025 recap (reference upload)', siteName: 'YouTube' });
    B.add({
      type: 'table', x: 520, y: 90, w: 380, title: 'Results',
      table: [['Metric', '2025'], ['Views (30 days)', '184k'], ['Avg. watch time', '41%'], ['Ticket CTR', '2.1%'], ['Sentiment', 'Positive, “informative”']],
    });
    B.add({ type: 'note', x: 520, y: 380, w: 380, color: 'yellow', text: p(b('Learnings for 2026')) + ul('Too many logistics up front — lead with people', 'Vertical cut outperformed 16:9 by 3×', 'End card needs a clear call to action') });
    B.add({ type: 'image', x: 0, y: 420, w: 480, url: PICSUM(399), fileName: 'recap-still.jpg', caption: 'Still from the 2025 film' });
    B.save(store, archive.id, 'graphite');
  }

  return project;
}
