// Verifies the Google Drive setup end to end: auth, Shared Drive access, upload, download, trash.
//   GOOGLE_SERVICE_ACCOUNT_JSON=... GOOGLE_DRIVE_ID=... npm run drive:check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Drive } from '../server/drive.js';

const { GOOGLE_SERVICE_ACCOUNT_JSON: creds, GOOGLE_DRIVE_ID: driveId } = process.env;
if (!creds || !driveId) {
  console.error('Set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_DRIVE_ID first.');
  process.exit(1);
}
const step = (s) => process.stdout.write(`• ${s} … `);
try {
  const drive = new Drive(creds, driveId);
  step(`Signing in as ${drive.email}`); await drive.accessToken(); console.log('ok');
  step('Opening the Shared Drive'); const d = await drive.check(); console.log(`ok (“${d.name}”)`);
  step('Creating _Healthcheck folder'); const folder = await drive.ensureFolder('_Healthcheck'); console.log('ok');
  const tmp = path.join(os.tmpdir(), `rb-check-${Date.now()}.bin`);
  const data = Buffer.alloc(3 * 1024 * 1024, 7);
  fs.writeFileSync(tmp, data);
  step('Uploading a 3 MB test file'); const id = await drive.upload(tmp, { name: 'healthcheck.bin', mime: 'application/octet-stream', parent: folder }); console.log('ok');
  step('Reading it back with a byte range'); const r = await drive.download(id, { range: 'bytes=100-199' });
  const part = Buffer.from(await r.arrayBuffer());
  if (r.status !== 206 || part.length !== 100) throw new Error(`expected 206 / 100 bytes, got ${r.status} / ${part.length}`);
  console.log('ok');
  step('Cleaning up'); await drive.trash(id); fs.rmSync(tmp); console.log('ok');
  console.log('\n✅ Google Drive storage is set up correctly.');
} catch (err) {
  console.log('FAILED');
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
}
