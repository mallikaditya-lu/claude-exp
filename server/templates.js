import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Saved card layouts (a storyboard group, a shot-list table, a checklist…) the team can drop
// onto any board. Stored in templates.json, positions relative to the template's top-left corner.

const CATEGORY = { column: 'Groups', table: 'Tables', todo: 'To-do lists', note: 'Notes', heading: 'Headings' };

export class Templates {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'templates.json');
    try {
      this.list = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.list = [];
    }
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.list));
    fs.renameSync(tmp, this.file);
  }

  summaries() {
    return this.list
      .map((t) => ({ id: t.id, name: t.name, category: t.category, count: t.items.filter((i) => !i.parentId).length, createdBy: t.createdBy, createdAt: t.createdAt }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  get(id) {
    return this.list.find((t) => t.id === id) || null;
  }

  /** Is this uploaded file shown in any template? (Templates are shared by the whole core team.) */
  usesFile(url) {
    return this.list.some((t) => JSON.stringify(t.items).includes(url));
  }

  create({ name, category, items, connections }, by) {
    if (!Array.isArray(items) || !items.length) throw new Error('Select some cards to save as a template');
    if (items.length > 500) throw new Error('That’s too many cards for one template');
    const clean = items.filter((i) => i && typeof i.id === 'string' && typeof i.type === 'string' && i.type !== 'board');
    if (!clean.length) throw new Error('Board cards can’t be saved in templates');
    const top = clean.filter((i) => !i.parentId || !clean.some((p) => p.id === i.parentId));
    const x0 = Math.min(...top.map((i) => Number(i.x) || 0));
    const y0 = Math.min(...top.map((i) => Number(i.y) || 0));
    const placed = clean.map((i) => (top.includes(i) ? { ...i, parentId: null, x: Math.round((Number(i.x) || 0) - x0), y: Math.round((Number(i.y) || 0) - y0) } : i));
    const ids = new Set(placed.map((i) => i.id));
    const kinds = new Set(top.map((i) => i.type));
    const auto = kinds.size === 1 ? CATEGORY[[...kinds][0]] || 'Other' : 'Layouts';
    const t = {
      id: crypto.randomUUID(),
      name: String(name || '').trim().slice(0, 80) || 'Untitled template',
      category: String(category || '').trim().slice(0, 40) || auto,
      items: placed,
      connections: (Array.isArray(connections) ? connections : []).filter((c) => c && ids.has(c.from) && ids.has(c.to)),
      createdBy: by,
      createdAt: Date.now(),
    };
    if (JSON.stringify(t).length > 2_000_000) throw new Error('That template is too large');
    this.list.push(t);
    this.save();
    return t;
  }

  remove(id) {
    const before = this.list.length;
    this.list = this.list.filter((t) => t.id !== id);
    if (this.list.length !== before) this.save();
    return this.list.length !== before;
  }
}
