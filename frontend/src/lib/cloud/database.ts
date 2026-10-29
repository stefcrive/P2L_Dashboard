import 'server-only';
import { Pool, types, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

// Preserve the local PGlite result contract so every existing query builder,
// relation, parameterized filter and transaction can use hosted Postgres.
types.setTypeParser(1700, Number);
types.setTypeParser(20, Number);
types.setTypeParser(1082, String);
types.setTypeParser(1114, String);
types.setTypeParser(1184, String);
let sharedPool: Pool | undefined;
export function cloudEnabled() { return process.env.APP_DATABASE_MODE === 'neon'; }

function pool() {
  if (!sharedPool) {
    if (!process.env.DATABASE_URL) throw new Error('The hosted database is not configured.');
    sharedPool = new Pool({connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 15000});
    attachDatabasePool(sharedPool);
  }
  return sharedPool;
}

export class CloudDatabase {
  constructor(private client?: PoolClient) {}
  async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []) {
    const result = await (this.client ?? pool()).query(sql, values);
    return { rows: result.rows as T[], affectedRows: result.rowCount ?? 0, fields: result.fields };
  }
  async exec(sql: string) {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql) && !this.client) {
      throw new Error('Hosted transactions must use database.transaction().');
    }
    const result = await (this.client ?? pool()).query(sql);
    return [result];
  }
  async transaction<T>(action: (database: CloudDatabase) => Promise<T>): Promise<T> {
    if (this.client) return action(this);
    const client = await pool().connect();
    try { await client.query('BEGIN'); const result = await action(new CloudDatabase(client)); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async dumpDataDir(): Promise<Blob> { throw new Error('Use the hosted database export.'); }
}
const database = new CloudDatabase();
export function getCloudDatabase() { return database; }
