import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const values = parseEnv(readFileSync(path.join(root, '.env.cloud.local'), 'utf8'));
const env = { ...process.env };
for (const key of ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'OPENAI_API_KEY']) {
  if (values[key] && values[key] !== '[SENSITIVE]') env[key] = values[key];
}
for (const key of ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN']) {
  if (!env[key] || env[key] === '[SENSITIVE]') throw new Error(`${key} is missing from .env.cloud.local.`);
}
delete env.VERCEL;
Object.assign(env, {
  APP_DATABASE_MODE: 'neon', P2L_REQUIRE_AUTH: '1',
  IRMS_AUTH_URL: 'https://irms-metrology-station.vercel.app/api/irms',
  NEXT_DIST_DIR: '.next-cloud', KNOWLEDGE_DB_PATH: '/tmp/p2l-knowledge',
});
if (process.argv.includes('--check')) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query('SELECT count(*)::int AS count FROM clients');
    console.log(`Cloud connection ready: ${result.rows[0].count} clients. No records changed.`);
  } finally { await client.end(); }
} else {
  console.log('Local P2L uses the operational cloud database. Saved changes are live.');
  console.log('Open http://localhost:3211 and sign in with your IRMS account.');
  const next = fileURLToPath(import.meta.resolve('next/dist/bin/next'));
  const result = spawnSync(process.execPath, [next, 'dev', '--hostname', '127.0.0.1', '--port', '3211'], {
    cwd: path.join(root, 'frontend'), env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
