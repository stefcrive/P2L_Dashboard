import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = parseEnv(await fs.readFile(path.join(root,'outputs/vercel-migration/production.env'),'utf8'));
const snapshot = path.join(root,'outputs/vercel-migration/app-postgres');
try { await fs.access(snapshot); } catch { await fs.cp(path.join(root,'.local-data/app-postgres'),snapshot,{recursive:true}); }
const local=await PGlite.create(snapshot);
const remote=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED || env.DATABASE_URL});
await remote.connect();
try {
  await remote.query('BEGIN');
  const schema=(await fs.readFile(path.join(root,'frontend/src/lib/local-db/schema.ts'),'utf8')).split('`')[1];
  const knowledge=(await fs.readFile(path.join(root,'frontend/src/lib/knowledge/schema.ts'),'utf8')).split('`')[1];
  await remote.query(schema);
  await remote.query(knowledge);
  const {rows:tables}=await local.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if((await remote.query('SELECT count(*) FROM clients')).rows[0].count!=='0') throw new Error('Cloud already contains client records; refusing to overwrite.');
  // Load parent rows before children, then constraints validate the complete import.
  const order=['clients','providers','materials_inventory','equipment_assets','client_documents','assistant_uploads','client_credit_events','material_stock_movements','provider_materials','material_purchase_lists','material_purchase_list_items','client_results','client_result_files','result_measurements','client_invoices','invoice_items','invoice_settings','gmail_connections','lab_book_entries','backup_records'];
  const counts={};
  for(const table of [...order,...tables.map(t=>t.tablename).filter(t=>!order.includes(t))]) {
    const {rows}=await local.query(`SELECT * FROM public."${table}"`);
    // Singleton defaults are schema seeds. Replace only these in the new database.
    if(table==='invoice_settings') await remote.query('DELETE FROM invoice_settings');
    for(const row of rows) {
      const keys=Object.keys(row);
      const values=keys.map(k=>row[k] instanceof Uint8Array ? Buffer.from(row[k]) : row[k]);
      await remote.query(`INSERT INTO public."${table}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`,values);
    }
    counts[table]=Number((await remote.query(`SELECT count(*) FROM public."${table}"`)).rows[0].count);
    if(counts[table]!==rows.length && rows.length) throw new Error(`Count mismatch for ${table}`);
    console.log(table,counts[table]);
  }
  await remote.query('COMMIT');
  await fs.writeFile(path.join(root,'outputs/vercel-migration/counts.json'),JSON.stringify(counts,null,2));
  console.log('Hosted records copied and counts verified.');
} catch(error) { await remote.query('ROLLBACK'); console.error(error.message); process.exitCode=1; }
finally { await local.close(); await remote.end(); }
