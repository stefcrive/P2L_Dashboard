import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import {
  getLocalAppDatabase,
  getLocalAppDatabaseInfo,
} from '@/lib/local-db/db';
import { getApplicationDatabaseSource } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_TABLES = [
  'clients',
  'client_documents',
  'assistant_uploads',
  'client_credit_events',
  'materials_inventory',
  'material_stock_movements',
  'providers',
  'provider_materials',
  'material_purchase_lists',
  'material_purchase_list_items',
  'client_results',
  'client_result_files',
  'result_measurements',
  'client_invoices',
  'invoice_items',
  'equipment_assets',
  'lab_book_entries',
  'backup_records',
] as const;

async function directorySize(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(entryPath);
      if (!entry.isFile()) return 0;
      return (await fs.stat(entryPath)).size;
    }),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function GET() {
  try {
    const source = getApplicationDatabaseSource();
    if (source === 'supabase') {
      return NextResponse.json({
        source,
        engine: 'Supabase PostgreSQL',
        migrationTarget: 'Supabase PostgreSQL',
      });
    }

    const database = await getLocalAppDatabase();
    const info = getLocalAppDatabaseInfo();
    const [migrationResult, ...countResults] = await Promise.all([
      database.query<{ version: number; applied_at: string }>(
        `SELECT version, applied_at
         FROM app_local.schema_migrations
         ORDER BY version DESC
         LIMIT 1`,
      ),
      ...DATA_TABLES.map((table) =>
        database.query<{ count: number }>(
          `SELECT count(*)::bigint AS count FROM public.${table}`,
        ),
      ),
    ]);

    return NextResponse.json({
      source,
      ...info,
      sizeBytes: await directorySize(info.path),
      schemaVersion: migrationResult.rows[0]?.version ?? null,
      schemaAppliedAt: migrationResult.rows[0]?.applied_at ?? null,
      counts: Object.fromEntries(
        DATA_TABLES.map((table, index) => [
          table,
          Number(countResults[index].rows[0]?.count ?? 0),
        ]),
      ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to inspect the application database.',
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  if (getApplicationDatabaseSource() !== 'local') {
    return NextResponse.json(
      { error: 'Embedded database backups are available only in local mode.' },
      { status: 400 },
    );
  }

  const database = await getLocalAppDatabase();
  const info = getLocalAppDatabaseInfo();
  const backupDirectory = path.resolve(path.dirname(info.path), 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(
    backupDirectory,
    `app-postgres-${timestamp}.tar.gz`,
  );
  let backupId: string | null = null;

  try {
    await fs.mkdir(backupDirectory, { recursive: true });
    const record = await database.query<{ id: string }>(
      `INSERT INTO public.backup_records
        (system_name, backup_type, status, destination, notes)
       VALUES ('P2L Dashboard', 'database', 'running', $1, $2)
       RETURNING id`,
      [destination, 'PGlite data-directory snapshot'],
    );
    backupId = record.rows[0]?.id ?? null;

    const dump = await database.dumpDataDir('gzip');
    const bytes = Buffer.from(await dump.arrayBuffer());
    await fs.writeFile(destination, bytes, { flag: 'wx' });

    if (backupId) {
      await database.query(
        `UPDATE public.backup_records
         SET status = 'completed',
             completed_at = now(),
             size_bytes = $1,
             verified = true
         WHERE id = $2`,
        [bytes.byteLength, backupId],
      );
    }

    return NextResponse.json({
      source: 'local',
      destination,
      sizeBytes: bytes.byteLength,
      verified: true,
    });
  } catch (error) {
    if (backupId) {
      await database
        .query(
          `UPDATE public.backup_records
           SET status = 'failed',
               completed_at = now(),
               notes = $1
           WHERE id = $2`,
          [
            error instanceof Error ? error.message : 'Backup failed.',
            backupId,
          ],
        )
        .catch(() => undefined);
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to back up the database.',
      },
      { status: 500 },
    );
  }
}
