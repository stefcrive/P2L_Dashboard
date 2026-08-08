import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

import { PGlite, types } from '@electric-sql/pglite';

import { getWorkspaceEnvironmentValue } from '@/lib/knowledge/config';

import { LOCAL_APP_SCHEMA_SQL, LOCAL_APP_SCHEMA_VERSION } from './schema';
import { seedLabBookHistory } from '@/lib/lab-book/history';

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, 'frontend'))
    ) ?? process.cwd()
  );
}

function getLocalAppDatabasePath() {
  const repositoryRoot = findRepositoryRoot();
  const configured =
    getWorkspaceEnvironmentValue('APP_DATABASE_PATH') ??
    '.local-data/app-postgres';
  const databasePath = path.isAbsolute(configured)
    ? configured
    : path.resolve(repositoryRoot, configured);
  fs.mkdirSync(databasePath, { recursive: true });
  return databasePath;
}

async function getAppliedSchemaVersion(database: PGlite) {
  const relation = await database.query<{ relation_name: string | null }>(
    "SELECT to_regclass('app_local.schema_migrations')::text AS relation_name"
  );
  if (!relation.rows[0]?.relation_name) return 0;

  const result = await database.query<{ version: number }>(
    'SELECT COALESCE(max(version), 0)::integer AS version FROM app_local.schema_migrations'
  );
  return Number(result.rows[0]?.version ?? 0);
}

async function createLocalAppDatabase() {
  const database = await PGlite.create(getLocalAppDatabasePath(), {
    relaxedDurability: false,
    parsers: {
      [types.NUMERIC]: Number,
      [types.INT8]: Number,
      [types.DATE]: String,
      [types.TIMESTAMP]: String,
      [types.TIMESTAMPTZ]: String,
    },
  });
  const appliedSchemaVersion = await getAppliedSchemaVersion(database);
  if (appliedSchemaVersion < LOCAL_APP_SCHEMA_VERSION) {
    await database.exec(LOCAL_APP_SCHEMA_SQL);
  }
  await seedLabBookHistory(database);
  return database;
}

type LocalAppDatabase = Awaited<ReturnType<typeof createLocalAppDatabase>>;

declare global {
  // eslint-disable-next-line no-var
  var __localAppDatabase: Promise<LocalAppDatabase> | undefined;
  // eslint-disable-next-line no-var
  var __localAppDatabaseSchemaVersion: number | undefined;
  // eslint-disable-next-line no-var
  var __localAppDatabaseSchemaUpdate: Promise<LocalAppDatabase> | undefined;
}

export function getLocalAppDatabase() {
  if (!globalThis.__localAppDatabase) {
    globalThis.__localAppDatabase = createLocalAppDatabase().then(
      (database) => {
        globalThis.__localAppDatabaseSchemaVersion = LOCAL_APP_SCHEMA_VERSION;
        return database;
      }
    );
  }

  // Next.js keeps global state across development hot reloads. Re-run the
  // idempotent schema when application code introduces a newer schema version
  // so a route cannot keep using a pre-migration PGlite connection.
  if (
    globalThis.__localAppDatabaseSchemaVersion !== LOCAL_APP_SCHEMA_VERSION &&
    !globalThis.__localAppDatabaseSchemaUpdate
  ) {
    const schemaUpdate = globalThis.__localAppDatabase.then(
      async (database) => {
        await database.exec(LOCAL_APP_SCHEMA_SQL);
        await seedLabBookHistory(database);
        globalThis.__localAppDatabaseSchemaVersion = LOCAL_APP_SCHEMA_VERSION;
        return database;
      }
    );
    globalThis.__localAppDatabaseSchemaUpdate = schemaUpdate;
    void schemaUpdate.then(
      () => {
        if (globalThis.__localAppDatabaseSchemaUpdate === schemaUpdate) {
          globalThis.__localAppDatabaseSchemaUpdate = undefined;
        }
      },
      () => {
        if (globalThis.__localAppDatabaseSchemaUpdate === schemaUpdate) {
          globalThis.__localAppDatabaseSchemaUpdate = undefined;
        }
      }
    );
  }

  return (
    globalThis.__localAppDatabaseSchemaUpdate ?? globalThis.__localAppDatabase
  );
}

export function getLocalAppDatabaseInfo() {
  return {
    engine: 'PGlite / PostgreSQL',
    path: getLocalAppDatabasePath(),
    migrationTarget: 'Supabase PostgreSQL',
  };
}
