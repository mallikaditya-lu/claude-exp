import fs from 'node:fs';
import path from 'node:path';

// Generates the demo project's local files (artwork, audio, a PDF call sheet, a CSV budget)
// so the demo works offline and shows real uploads, not just links.

const W = 800;
const H = 450;

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const FONT = `font-family="Helvetica, Arial, sans-serif"`;

function frame(n, title, scene, sky = ['#1a1f4a', '#f08a5d']) {
  return svg(W, H, `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#s)"/>
    ${scene}
    <rect y="${H - 54}" width="${W}" height="54" fill="rgba(10,12,30,.72)"/>
    <text x="24" y="${H - 20}" ${FONT} font-size="24" font-weight="700" fill="#fff">${String(n).padStart(2, '0')}</text>
    <text x="70" y="${H - 20}" ${FONT} font-size="22" fill="#e9e6ff">${title}</text>
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>`);
}

function skyline(base, color) {
  const widths = [60, 40, 80, 50, 90, 45, 70, 55, 100, 60, 40, 75];
  let x = 0;
  let out = '';
  widths.forEach((w, i) => {
    const h = 60 + ((i * 53) % 150);
    out += `<rect x="${x}" y="${base - h}" width="${w - 6}" height="${h}" fill="${color}"/>`;
    for (let wy = base - h + 12; wy < base - 12; wy += 18) {
      if ((wy + i) % 3) out += `<rect x="${x + 8}" y="${wy}" width="6" height="8" fill="#ffd58a" opacity=".7"/>`;
    }
    x += w;
  });
  return out;
}

function people(y, count, color, scale = 1) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = 40 + ((i * 97) % (W - 80));
    const yy = y + ((i * 31) % 40);
    out += `<circle cx="${x}" cy="${yy}" r="${13 * scale}" fill="${color}"/><rect x="${x - 17 * scale}" y="${yy + 14 * scale}" width="${34 * scale}" height="${60 * scale}" rx="${14 * scale}" fill="${color}"/>`;
  }
  return out;
}

function aurora(seed, colors) {
  let blobs = '';
  colors.forEach((c, i) => {
    const cx = 120 + ((seed * 131 + i * 197) % 560);
    const cy = 80 + ((seed * 71 + i * 113) % 260);
    blobs += `<ellipse cx="${cx}" cy="${cy}" rx="${220 - i * 20}" ry="${70 + i * 12}" fill="${c}" opacity=".75" transform="rotate(${-20 + i * 14} ${cx} ${cy})"/>`;
  });
  return svg(W, H, `
    <defs><filter id="b"><feGaussianBlur stdDeviation="38"/></filter></defs>
    <rect width="${W}" height="${H}" fill="#070b1f"/>
    <g filter="url(#b)">${blobs}</g>
    ${Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 137) % W}" cy="${(i * 89) % H}" r="${i % 5 ? 1 : 1.8}" fill="#fff" opacity=".6"/>`).join('')}`);
}

const PALETTE = [
  ['Night sky', '#0B1026'],
  ['Aurora violet', '#6D4AFF'],
  ['Glacier teal', '#19C3B1'],
  ['Borealis green', '#7CF29A'],
  ['Paper white', '#F4EFE6'],
];

function palette() {
  const sw = W / PALETTE.length;
  return svg(W, 400, PALETTE.map(([name, hex], i) => `
    <rect x="${i * sw}" width="${sw}" height="400" fill="${hex}"/>
    <text x="${i * sw + 18}" y="340" ${FONT} font-size="17" font-weight="700" fill="${i === 4 || i === 3 ? '#0B1026' : '#fff'}">${name}</text>
    <text x="${i * sw + 18}" y="368" ${FONT} font-size="15" fill="${i === 4 || i === 3 ? '#0B1026' : '#fff'}" opacity=".8">${hex}</text>`).join(''));
}

function typeSpecimen() {
  return svg(W, H, `
    <rect width="${W}" height="${H}" fill="#F4EFE6"/>
    <text x="40" y="190" font-family="Georgia, 'Times New Roman', serif" font-size="170" fill="#0B1026">Aa</text>
    <text x="300" y="110" ${FONT} font-size="15" fill="#6D4AFF" font-weight="700" letter-spacing="3">HEADLINES · SERIF</text>
    <text x="300" y="150" font-family="Georgia, serif" font-size="34" fill="#0B1026">Light after dark</text>
    <text x="300" y="215" ${FONT} font-size="15" fill="#6D4AFF" font-weight="700" letter-spacing="3">BODY · SANS</text>
    <text x="300" y="248" ${FONT} font-size="20" fill="#0B1026">Where the next decade of builders meets.</text>
    <line x1="40" y1="290" x2="760" y2="290" stroke="#0B1026" opacity=".15"/>
    <text x="40" y="340" ${FONT} font-size="15" fill="#0B1026" opacity=".7">Tracking +2% on caps · 1.35 line height · never below 14px on screen</text>
    <text x="40" y="385" ${FONT} font-size="44" font-weight="800" fill="#0B1026" letter-spacing="6">AURORA SUMMIT</text>`);
}

function logo() {
  return svg(900, 300, `
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1026"/><stop offset=".6" stop-color="#2a1f6e"/><stop offset="1" stop-color="#19C3B1"/></linearGradient></defs>
    <rect width="900" height="300" fill="url(#g)"/>
    <path d="M70 200 Q 160 60 250 200" fill="none" stroke="#7CF29A" stroke-width="10" stroke-linecap="round"/>
    <path d="M95 200 Q 160 100 225 200" fill="none" stroke="#6D4AFF" stroke-width="10" stroke-linecap="round"/>
    <text x="290" y="160" ${FONT} font-size="64" font-weight="800" fill="#fff" letter-spacing="8">AURORA</text>
    <text x="292" y="210" ${FONT} font-size="30" fill="#c9c2ff" letter-spacing="14">SUMMIT 2026 · LISBON</text>`);
}

const FRAMES = [
  ['Aerial — Lisbon at dawn', `<circle cx="620" cy="250" r="60" fill="#ffd27a" opacity=".9"/>${skyline(396, '#241c4a')}`, ['#2b2a6b', '#f7a06b']],
  ['Crowd arrives — badges, energy', `<rect y="300" width="${W}" height="100" fill="#3b2f63"/>${people(250, 16, '#171433')}`, ['#46407a', '#9d8bd6']],
  ['Keynote — the room goes quiet', `<rect x="140" y="250" width="520" height="146" fill="#130f2e"/><path d="M400 0 L300 300 L500 300 Z" fill="#fff8d6" opacity=".25"/><circle cx="400" cy="205" r="18" fill="#0b0920"/><rect x="380" y="222" width="40" height="80" rx="16" fill="#0b0920"/>${people(330, 10, '#07061a', 0.7)}`, ['#0b0920', '#2e2560']],
  ['Close-up — hands, laptops, lanyards', `<rect x="230" y="70" width="340" height="260" rx="24" fill="#F4EFE6"/><rect x="230" y="70" width="340" height="70" rx="24" fill="#6D4AFF"/><text x="400" y="118" text-anchor="middle" ${FONT} font-size="30" font-weight="800" fill="#fff">SPEAKER</text><circle cx="400" cy="210" r="42" fill="#19C3B1"/><rect x="300" y="270" width="200" height="16" rx="8" fill="#0B1026" opacity=".7"/><path d="M400 0 L400 70" stroke="#6D4AFF" stroke-width="16"/>`, ['#2d2350', '#6d4aff']],
  ['Workshop — ideas on the wall', `<rect x="90" y="60" width="620" height="250" rx="8" fill="#fbfaf5"/><path d="M130 120 q40 -30 80 0 t80 0 M140 180 h200 M140 220 h150 M420 110 l60 60 l80 -80" stroke="#6D4AFF" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="560" y="200" width="110" height="80" fill="#ffe27a"/>${people(320, 6, '#1d1840', 0.9)}`, ['#3a3170', '#8a7fd0']],
  ['Night — aurora over the venue', `<path d="M0 160 C 200 60 350 220 800 90 L800 190 C 450 300 250 150 0 250 Z" fill="#7CF29A" opacity=".45"/><path d="M0 120 C 250 40 450 180 800 60 L800 110 C 400 220 250 90 0 180 Z" fill="#6D4AFF" opacity=".45"/>${skyline(396, '#050617')}<text x="400" y="80" text-anchor="middle" ${FONT} font-size="30" font-weight="800" fill="#fff" letter-spacing="8">AURORA SUMMIT</text>`, ['#050617', '#101a4a']],
];

// ---------- audio ----------
function wav(seconds, fn, sr = 22050) {
  const n = Math.floor(seconds * sr);
  const samples = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    samples[i] = fn(i / sr, i);
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const gain = peak ? 0.7 / peak : 1;
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), 44 + i * 2);
  return buf;
}

const TAU = Math.PI * 2;
const CHORDS = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];

const padTrack = () => wav(12, (t) => {
  const c = CHORDS[Math.floor(t / 3) % 4];
  const local = t % 3;
  const env = Math.min(1, local / 0.8) * Math.min(1, (3 - local) / 0.6);
  const master = Math.min(1, t / 1.5) * Math.min(1, (12 - t) / 2);
  let s = 0;
  for (const f of c) s += Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.003 * t) + 0.15 * Math.sin(TAU * f * 2 * t);
  return s * env * master;
});

const pulseTrack = () => wav(10, (t) => {
  const step = 0.25;
  const c = CHORDS[Math.floor(t / 2.5) % 4];
  const k = Math.floor(t / step);
  const f = c[k % 3] * (k % 8 >= 6 ? 2 : 1);
  const local = t - k * step;
  const pluck = Math.exp(-local * 9) * Math.sin(TAU * f * 2 * t);
  const bass = 0.6 * Math.sin(TAU * (c[0] / 2) * t) * (0.6 + 0.4 * Math.exp(-(t % 0.5) * 6));
  const master = Math.min(1, t / 0.5) * Math.min(1, (10 - t) / 1.5);
  return (pluck + bass) * master;
});

const roomTone = () => {
  let lp = 0;
  let x = 12345;
  return wav(8, (t) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const noise = x / 0x3fffffff - 1;
    lp += 0.04 * (noise - lp);
    const murmur = 0.4 + 0.3 * Math.sin(TAU * 0.3 * t) + 0.2 * Math.sin(TAU * 0.71 * t);
    return lp * murmur + 0.05 * Math.sin(TAU * 50 * t);
  });
};

// ---------- PDF ----------
function pdf(title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  let text = `BT /F1 22 Tf 56 780 Td (${esc(title)}) Tj /F1 11 Tf 0 -34 Td`;
  for (const l of lines) text += ` (${esc(l)}) Tj 0 -17 Td`;
  text += ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

const CALL_SHEET = [
  'Production: Aurora Summit 2026 - hero film        Day 1 of 2 - Thu 26 Feb',
  'Location: Lisbon Congress Centre, Praca das Industrias, 1300-307 Lisboa',
  'Crew call 06:30   |   Sunrise 07:21   |   Wrap 19:00   |   Nearest hospital: Hosp. Egas Moniz',
  '',
  '06:30  Crew call, breakfast at loading bay B',
  '07:00  Drone team: aerial of venue + river at first light (scene 1)',
  '08:30  Main hall: arrivals, badges, registration desks (scene 2)',
  '10:00  Keynote rehearsal - stage lighting test (scene 3)',
  '12:30  Lunch',
  '13:30  Close-ups: hands, laptops, lanyards, coffee (scene 4)',
  '15:00  Workshop room 2.1 - whiteboard session with 12 extras (scene 5)',
  '17:30  Founder walk-and-talks on the terrace',
  '19:00  Wrap, data backup x2, drives to post by courier',
  '',
  'Key contacts: Maya Chen (Producer) +351 912 000 111  |  Jon Ade (Director) +351 912 000 222',
  'Notes: hi-vis on the loading bay; no drone flights after 08:15 (airport corridor).',
];

const BUDGET = `Line,Category,Estimate (EUR),Actual (EUR),Notes
1,Director & crew (2 days),18500,18200,
2,Drone team + permits,3200,3450,Extra permit for river
3,Camera & lighting package,6800,6800,
4,Extras (12) + talent,4200,3900,
5,Location fees,2500,2500,Congress Centre included
6,Edit (10 days),9000,,In progress
7,Colour & VFX,4500,,
8,Music licence or composer,6000,,Decision pending
9,Sound design & mix,3500,,
10,Contingency (10%),5800,,
,Total,64000,34850,
`;

export const DEMO_TRACKS = [
  { file: 'demo-theme-option-a-ambient.wav', name: 'Theme option A — ambient pad (composer demo).wav', make: padTrack },
  { file: 'demo-theme-option-b-pulse.wav', name: 'Theme option B — pulse (composer demo).wav', make: pulseTrack },
  { file: 'demo-room-tone-main-hall.wav', name: 'Room tone — main hall.wav', make: roomTone },
];

/** Write every demo asset into the uploads folder. Returns metadata keyed by short name. */
export function writeDemoAssets(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const out = {};
  const put = (key, file, name, data, mime) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fs.writeFileSync(path.join(uploadDir, file), buf);
    out[key] = { url: `/uploads/${file}`, fileName: name, size: buf.length, mime };
  };
  put('logo', 'demo-aurora-logo.svg', 'Aurora Summit logo lockup.svg', logo(), 'image/svg+xml');
  put('palette', 'demo-palette.svg', 'Palette — light after dark.svg', palette(), 'image/svg+xml');
  put('type', 'demo-type-specimen.svg', 'Type specimen.svg', typeSpecimen(), 'image/svg+xml');
  [[1, ['#6D4AFF', '#19C3B1', '#7CF29A']], [2, ['#19C3B1', '#2a60ff', '#7CF29A']], [3, ['#7CF29A', '#6D4AFF', '#ff6fb5']]].forEach(([seed, colors]) =>
    put(`aurora${seed}`, `demo-aurora-${seed}.svg`, `Aurora study ${seed}.svg`, aurora(seed, colors), 'image/svg+xml'));
  FRAMES.forEach(([title, scene, sky], i) =>
    put(`frame${i + 1}`, `demo-frame-${i + 1}.svg`, `Storyboard frame ${i + 1}.svg`, frame(i + 1, title, scene, sky), 'image/svg+xml'));
  DEMO_TRACKS.forEach((t, i) => put(`track${i + 1}`, t.file, t.name, t.make(), 'audio/wav'));
  put('callsheet', 'demo-call-sheet-day-1.pdf', 'Call sheet — Day 1.pdf', pdf('Call sheet - Day 1', CALL_SHEET), 'application/pdf');
  put('budget', 'demo-budget.csv', 'Production budget v4.csv', BUDGET, 'text/csv');
  return out;
}
