import 'server-only';

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';

import { getKnowledgeConfig } from './config';
import { KNOWLEDGE_SCHEMA_SQL } from './schema';

async function createKnowledgeDatabase() {
  const config = getKnowledgeConfig();
  const database = await PGlite.create(config.databasePath, {
    extensions: { vector, pg_trgm },
    relaxedDurability: false,
  });
  await database.exec(KNOWLEDGE_SCHEMA_SQL);
  return database;
}

type KnowledgeDatabase = Awaited<ReturnType<typeof createKnowledgeDatabase>>;

declare global {
  // eslint-disable-next-line no-var
  var __knowledgeDatabase: Promise<KnowledgeDatabase> | undefined;
}

export function getKnowledgeDatabase() {
  if (!globalThis.__knowledgeDatabase) {
    globalThis.__knowledgeDatabase = createKnowledgeDatabase();
  }
  return globalThis.__knowledgeDatabase;
}

export function asVectorLiteral(values: number[]) {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}
