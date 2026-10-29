import fs from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import pg from 'pg';
const root=process.cwd(), folder=path.join(root,'outputs/newbackup-migration');
const env=parseEnv(await fs.readFile(path.join(root,'outputs/vercel-migration/production.env'),'utf8'));
const remote=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL});await remote.connect();
const q=s=>'"'+s.replaceAll('"','""')+'"';
const locals=[];
try {
 const previous={};
 const tables=(await remote.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','kb','app_local') ORDER BY schemaname,tablename")).rows;
 for(const t of tables) previous[t.schemaname+'.'+t.tablename]=(await remote.query(`SELECT * FROM ${q(t.schemaname)}.${q(t.tablename)}`)).rows;
 // Before replacing the earlier migration, retain its complete recoverable export.
 await fs.writeFile(path.join(folder,'cloud-before-upgrade.json'),JSON.stringify(previous));
 console.log('Pre-upgrade snapshot saved; counts',JSON.stringify(Object.fromEntries(Object.entries(previous).map(([k,v])=>[k,v.length]))));
 if(previous['public.clients'].some(r=>!r.name.startsWith('Deployment verification') && new Date(r.created_at) > new Date('2026-10-27'))) throw new Error('New user-created cloud records need reconciliation before migration.');
 const datasets=[];
 for(const name of ['app-postgres','knowledge-postgres']) {
  const db=await PGlite.create(path.join(folder,name),{extensions:{vector,pg_trgm}});locals.push(db);
  const tabs=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','kb','app_local') ORDER BY schemaname,tablename")).rows;
  const dependencies=(await db.query("SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f'")).rows;
  const normalized=s=>s.includes('.')?s:'public.'+s;
  const sorted=[];let todo=tabs;
  while(todo.length){const ready=todo.filter(t=>!dependencies.some(d=>normalized(d.child)===t.schemaname+'.'+t.tablename && todo.some(p=>normalized(d.parent)===p.schemaname+'.'+p.tablename && p!==t)));if(!ready.length)throw new Error('Cyclic foreign keys'); sorted.push(...ready);todo=todo.filter(t=>!ready.includes(t));}
  for(const t of sorted) {
   const cols=(await db.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND is_generated=\'NEVER\' ORDER BY ordinal_position',[t.schemaname,t.tablename])).rows;
   const rows=(await db.query(`SELECT ${cols.map(c=>q(c.column_name)).join(',')} FROM ${q(t.schemaname)}.${q(t.tablename)}`)).rows;
   // Resume interrupted local work explicitly; running processes were not transferred.
   if(t.tablename==='ingestion_jobs') for(const row of rows) if(['running','queued'].includes(row.status)) {row.status='paused';row.current_file=null;}
   if(t.tablename==='job_files') for(const row of rows) if(row.status==='running'){row.status='queued';row.stage='queued';row.started_at=null;}
   datasets.push({...t,cols,rows});
  }
 }
 await remote.query('BEGIN');
 for(const file of ['local-db/schema.ts','knowledge/schema.ts']) await remote.query((await fs.readFile(path.join(root,'frontend/src/lib',file),'utf8')).split('`')[1]);
 await remote.query('TRUNCATE '+datasets.map(t=>q(t.schemaname)+'.'+q(t.tablename)).join(',')+' RESTART IDENTITY');
 const counts={};
 for(const t of datasets){
  const qualified=q(t.schemaname)+'.'+q(t.tablename);
  for(let offset=0;offset<t.rows.length;offset+=100){
   const batch=t.rows.slice(offset,offset+100),values=[];
   const placeholders=batch.map(row=>'('+t.cols.map(c=>{let v=row[c.column_name]; if(v instanceof Uint8Array)v=Buffer.from(v);else if(v!==null && ['json','jsonb'].includes(c.data_type))v=JSON.stringify(v); values.push(v);return '$'+values.length;}).join(',')+')');
   await remote.query(`INSERT INTO ${qualified} (${t.cols.map(c=>q(c.column_name)).join(',')}) VALUES ${placeholders.join(',')}`,values);
  }
  const count=Number((await remote.query(`SELECT count(*) FROM ${qualified}`)).rows[0].count);
  if(count!==t.rows.length)throw new Error('Count mismatch '+qualified);
  counts[t.schemaname+'.'+t.tablename]=count;console.log(qualified,count);
  for(const c of t.cols){const seq=(await remote.query('SELECT pg_get_serial_sequence($1,$2) AS seq',[qualified,c.column_name])).rows[0].seq;if(seq)await remote.query(`SELECT setval($1,COALESCE((SELECT max(${q(c.column_name)}) FROM ${qualified}),1),(SELECT count(*)>0 FROM ${qualified}))`,[seq]);}
 }
 // Retain the verified hosted export record alongside the backup's history.
 for(const row of previous['public.backup_records'].filter(r=>String(r.destination).startsWith('blob://'))) {
  const keys=Object.keys(row);await remote.query(`INSERT INTO backup_records (${keys.map(q).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT DO NOTHING`,Object.values(row));
 }
 await remote.query('DELETE FROM kb.cloud_files');
 await remote.query('COMMIT');
 await fs.writeFile(path.join(folder,'cloud-counts.json'),JSON.stringify(counts,null,2));
 console.log('New backup migration committed and all row counts verified.');
}catch(e){await remote.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{for(const db of locals)await db.close();await remote.end();}
