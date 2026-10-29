import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cloudEnabled, getCloudDatabase } from './database';
import { readCloudDocument, storeCloudDocument } from './files';

const ROOT = '/tmp/p2l-knowledge';
function relativePath(input: string) {
  const relative = path.relative(ROOT, path.resolve(ROOT, input));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid knowledge source path.');
  return relative.split(path.sep).join('/');
}
async function database() {
  const db = getCloudDatabase();
  await db.query('CREATE TABLE IF NOT EXISTS kb.cloud_files (path TEXT PRIMARY KEY, reference TEXT NOT NULL)');
  return db;
}
export async function persistKnowledgeFile(input: string) {
  if (!cloudEnabled()) return;
  const name = relativePath(input);
  const reference = await storeCloudDocument(await fs.readFile(input));
  await (await database()).query('INSERT INTO kb.cloud_files(path,reference) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET reference=EXCLUDED.reference', [name, reference]);
}
export async function hydrateKnowledgePath(input: string) {
  if (!cloudEnabled()) return;
  const name = relativePath(input);
  const rows = (await (await database()).query<{ path: string; reference: string }>('SELECT path,reference FROM kb.cloud_files WHERE path=$1 OR starts_with(path,$2)', [name, name + '/'])).rows;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(6, rows.length) }, async () => {
   while (index < rows.length) {
    const row = rows[index++];
    const destination = path.resolve(ROOT, row.path);
    relativePath(destination);
    try {
      const cached = await fs.readFile(destination);
      if (createHash('sha256').update(cached).digest('hex') === row.reference.slice(7)) continue;
    } catch { /* A cold function instance hydrates the durable source below. */ }
    const bytes = await readCloudDocument(row.reference);
    if (!bytes) throw new Error('The stored knowledge source is unavailable.');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
   }
  }));
}
