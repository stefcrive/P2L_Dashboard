import fs from 'node:fs/promises';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {vector} from '@electric-sql/pglite-pgvector';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
const backup='E:/BACKUP/Migrate to laptop/P2L Dashboard';
const root=process.cwd();
const report={};
for(const name of ['app-postgres','knowledge-postgres']) {
 const dest=path.join(root,'outputs/newbackup-migration',name);
 try{await fs.access(dest);}catch{await fs.cp(path.join(backup,'.local-data',name),dest,{recursive:true});}
 const db=await PGlite.create(dest,{extensions:{vector,pg_trgm}});
 const tables=(await db.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','kb','app_local') ORDER BY schemaname,tablename")).rows;
 const counts={};
 for(const t of tables) counts[t.schemaname+'.'+t.tablename]=Number((await db.query(`SELECT count(*) FROM "${t.schemaname}"."${t.tablename}"`)).rows[0].count);
 report[name]={counts,size:(await db.query('SELECT pg_database_size(current_database()) as bytes')).rows[0].bytes};
 if(name==='knowledge-postgres') report[name].paths=(await db.query('SELECT source_path,format,byte_size FROM kb.sources LIMIT 5')).rows;
 await db.close();
 console.log(name,JSON.stringify(report[name]));
}
await fs.writeFile(path.join(root,'outputs/newbackup-migration/inspection.json'),JSON.stringify(report,null,2));
