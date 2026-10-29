import 'server-only';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';

import { getKnowledgeConfig } from './config';
import { KNOWLEDGE_SCHEMA_SQL, KNOWLEDGE_SCHEMA_VERSION } from './schema';
import { cloudEnabled, getCloudDatabase } from '@/lib/cloud/database';

async function createKnowledgeDatabase() {
  const config = getKnowledgeConfig();
  const database = await PGlite.create(config.databasePath, {
    extensions: { vector, pg_trgm },
    relaxedDurability: false,
  });
  await database.exec(KNOWLEDGE_SCHEMA_SQL);
  // A request cannot survive a local Next.js process restart, but its durable
  // queue claim can. Release those orphaned claims once when this process opens
  // the database so interrupted files are paused and safe to retry.
  await database.exec(`
    WITH interrupted AS (
      UPDATE kb.job_files
         SET status = 'queued', stage = 'queued', started_at = NULL,
             error = NULL, updated_at = now()
       WHERE status = 'running'
       RETURNING job_id
    )
    UPDATE kb.ingestion_jobs j
       SET status = CASE
             WHEN status IN ('cancelled', 'completed', 'failed') THEN status
             ELSE 'paused'
           END,
           stage = 'queued', current_file = NULL,
           heartbeat_at = now(), updated_at = now()
     WHERE j.id IN (SELECT job_id FROM interrupted);
  `);
  globalThis.__knowledgeSchemaVersion = KNOWLEDGE_SCHEMA_VERSION;
  return database;
}

type KnowledgeDatabase = Awaited<ReturnType<typeof createKnowledgeDatabase>>;

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeDatabase: Promise<KnowledgeDatabase> | undefined;
  // eslint-disable-next-line no-var
  var __knowledgeSchemaVersion: number | undefined;
  // eslint-disable-next-line no-var
  var __knowledgeSchemaMigration: Promise<void> | undefined;
}

export async function getKnowledgeDatabase() {
  if (cloudEnabled()) return Promise.resolve(getCloudDatabase());
  if (!globalThis.__knowledgeDatabase) {
    globalThis.__knowledgeDatabase = createKnowledgeDatabase();
  }
  const database = await globalThis.__knowledgeDatabase;

  // The PGlite instance survives Next.js hot reloads. Re-apply idempotent DDL
  // when the checked-in schema version advances so a dev server need not be
  // restarted before a newly added table can be used.
  if (globalThis.__knowledgeSchemaVersion !== KNOWLEDGE_SCHEMA_VERSION) {
    globalThis.__knowledgeSchemaMigration ??= database
      .exec(KNOWLEDGE_SCHEMA_SQL)
      .then(() => {
        globalThis.__knowledgeSchemaVersion = KNOWLEDGE_SCHEMA_VERSION;
      })
      .finally(() => {
        globalThis.__knowledgeSchemaMigration = undefined;
      });
    await globalThis.__knowledgeSchemaMigration;
  }

  return database;
}

export function asVectorLiteral(values: number[]) {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}
