import crypto from 'node:crypto';

// First-run content: a research board laid out like a typical film/campaign reference board,
// so new teammates can see every card type in context.
export function seedWelcomeBoard(store) {
  let z = 0;
  const id = () => crypto.randomUUID();
  const items = {};
  const connections = {};
  const add = (item) => {
    const full = { id: id(), z: ++z, createdAt: Date.now(), createdBy: 'Reference Board', ...item };
    items[full.id] = full;
    return full.id;
  };
  const link = (from, to) => {
    const cid = id();
    connections[cid] = { id: cid, from, to, shape: 'elbow' };
  };

  const project = store.createProject({ name: 'Example project', color: 'purple' });
  const root = store.create({ title: 'Welcome — Hero film research', projectId: project.id });
  const interviews = store.create({ title: 'Founder interviews', parentId: root.id });

  const hero = add({ type: 'heading', x: 620, y: 40, w: 220, text: 'Hero movie', color: 'red' });
  const narration = add({ type: 'heading', x: 80, y: 200, w: 220, text: 'Narration', color: 'purple' });
  const visual = add({ type: 'heading', x: 520, y: 200, w: 220, text: 'Visual reference', color: 'purple' });
  const style = add({ type: 'heading', x: 960, y: 200, w: 220, text: 'Narration style', color: 'purple' });
  const music = add({ type: 'heading', x: 1260, y: 200, w: 220, text: 'Music options', color: 'purple' });
  [narration, visual, style, music].forEach((h) => link(hero, h));

  const script = add({
    type: 'table', x: 40, y: 290, w: 420,
    table: [
      ['Time', 'Picture', 'Voiceover / sound'],
      ['00:00–00:08', 'Crowd shots, badges, hands, a room being prepared.', 'VO: "Every new market starts with a question…"'],
      ['00:08–00:20', 'Founders arrive and greet each other. Branding in the space.', 'VO: "…and the people willing to answer it together."'],
      ['00:20–00:32', 'Mentor chats, whiteboards, laughter.', 'Natural sound, room tone.'],
      ['00:32–00:45', 'Wide of the room. Push in on the logo.', 'VO: "This is where it starts."'],
    ],
  });
  link(narration, script);

  const note = add({
    type: 'note', x: 520, y: 290, w: 260,
    text: '<p><b>This is the flow for the hero movie.</b></p><p>It will be more cinematic — not too fast-moving. We play with ideas, venue, booths and people.</p><ul><li>Construction</li><li>Ideas</li><li>Getting some info from people</li></ul>',
  });
  link(visual, note);

  add({
    type: 'link', x: 520, y: 540, w: 300,
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    title: 'Big Buck Bunny', siteName: 'YouTube',
  });

  const todo = add({
    type: 'todo', x: 860, y: 290, w: 260, title: 'Shot list',
    todos: [
      { id: id(), text: 'Venue wide at golden hour', done: true },
      { id: id(), text: 'Badge + lanyard close-ups', done: false },
      { id: id(), text: 'Founder walk-and-talks', done: false },
    ],
  });
  link(style, todo);

  const col = add({ type: 'column', x: 1260, y: 290, w: 300, title: 'Tracks to audition', childIds: [] });
  link(music, col);
  const t1 = add({ type: 'link', x: 0, y: 0, w: 300, parentId: col, url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', title: 'Spotify track', siteName: 'Spotify' });
  const t2 = add({ type: 'note', x: 0, y: 0, w: 300, parentId: col, text: '<p>Drop audio files (mp3, wav) straight onto the board — they get a player right on the card.</p>' });
  items[col].childIds = [t1, t2];

  add({ type: 'board', x: 40, y: 760, w: 180, boardId: interviews.id, color: 'blue' });

  add({
    type: 'comment', x: 860, y: 520, w: 260, color: 'yellow',
    comments: [{ id: id(), author: 'Reference Board', text: 'Leave feedback for the team here. Press Enter to post.', at: Date.now() }],
  });

  add({
    type: 'note', x: -330, y: 290, w: 300, color: 'yellow',
    text: '<p><b>👋 How this works</b></p><ul><li>Drag cards from the left toolbar, or click to drop one in the middle.</li><li>Paste a link, image or text anywhere on the board.</li><li>Drop files from your computer: images, video, audio, PDFs.</li><li>Drag the small dot on a selected card onto another card to connect them.</li><li>Scroll to pan, ⌘/Ctrl + scroll or pinch to zoom.</li></ul>',
  });

  store.applyPatch(root.id, { upsertItems: Object.values(items), upsertConnections: Object.values(connections) });

  // A small nested board so the "Board" card has something inside it.
  const inner = [];
  let iz = 0;
  const innerAdd = (item) => inner.push({ id: id(), z: ++iz, createdAt: Date.now(), ...item });
  innerAdd({ type: 'heading', x: 200, y: 40, w: 240, text: 'Founder interviews', color: 'red' });
  innerAdd({ type: 'note', x: 60, y: 140, w: 260, text: '<p>This will be the intro for founders in the interview series.</p>' });
  innerAdd({ type: 'note', x: 360, y: 140, w: 260, text: '<p>Music will be acoustic — one track with a soft build.</p>' });
  store.applyPatch(interviews.id, { upsertItems: inner });
}
