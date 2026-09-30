// Adds the big demo project to an existing install:  npm run demo  (stop the app first).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { DEMO_PROJECT_NAME, seedDemoProject } from './demo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const store = new Store(DATA_DIR);

if (store.listProjects().some((p) => p.name === DEMO_PROJECT_NAME) && !process.argv.includes('--force')) {
  console.log(`“${DEMO_PROJECT_NAME}” already exists. Run with --force to add another copy.`);
  process.exit(0);
}
seedDemoProject(store, path.join(DATA_DIR, 'uploads'));
store.flushAll();
console.log(`Added “${DEMO_PROJECT_NAME}” to ${DATA_DIR}. Start the app with: npm start`);
