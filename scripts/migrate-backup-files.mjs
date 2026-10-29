import fs from 'node:fs/promises';import path from 'node:path';import {parseEnv} from 'node:util';import {createHash} from 'node:crypto';import pg from 'pg';import {put,get} from '@vercel/blob';
const root=process.cwd(),backup='E:/BACKUP/Migrate to laptop/P2L Dashboard';
const env=parseEnv(await fs.readFile('outputs/vercel-migration/production.env','utf8'));Object.assign(process.env,env);
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL});await db.connect();
const counts={documents:0,knowledgeFiles:0,existing:0,missing:[]};
const memo=new Map();
function relative(input){return String(input).replaceAll('\\','/').replace(/^.*?\/P2L Dashboard\//i,'').replace(/^\/tmp\/p2l-knowledge\//,'');}
async function bytesFor(input){const rel=relative(input);if(path.isAbsolute(rel)||/^[A-Za-z]:/.test(rel)||rel.split('/').includes('..'))throw new Error('Invalid source path '+rel);return fs.readFile(path.join(backup,rel));}
async function store(bytes){const digest=createHash('sha256').update(bytes).digest('hex');if(!memo.has(digest))memo.set(digest,(async()=>{await put('documents/'+digest,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:true});const downloaded=await get('documents/'+digest,{access:'private'});if(!downloaded || downloaded.statusCode!==200 || !Buffer.from(await new Response(downloaded.stream).arrayBuffer()).equals(bytes))throw new Error('Blob integrity mismatch');return 'blob://'+digest;})());return memo.get(digest);}
async function parallel(items,action){let i=0;await Promise.all(Array.from({length:4},async()=>{while(i<items.length){await action(items[i++]);}}));}
try{
 const docs=(await db.query('SELECT id,absolute_path,relative_path,content,content_sha256 FROM client_documents')).rows;
 await parallel(docs,async row=>{if(row.absolute_path.startsWith('blob://')){counts.existing++;return;}let bytes=row.content;if(!bytes){for(const candidate of [row.absolute_path,row.relative_path,'Clienti/'+row.relative_path]){try{bytes=await bytesFor(candidate);break;}catch{}}}if(!bytes){counts.missing.push('document:'+row.id);return;}if(row.content_sha256 && createHash('sha256').update(bytes).digest('hex')!==row.content_sha256)throw new Error('Source checksum differs '+row.id);const ref=await store(bytes);await db.query('UPDATE client_documents SET absolute_path=$1,content=NULL,content_sha256=$2 WHERE id=$3',[ref,ref.slice(7),row.id]);counts.documents++;});
 console.log('Client documents verified',counts.documents,'existing',counts.existing);
 const paths=new Set();
 for(const [table,columns,absolute] of [['sources',['source_path'],false],['job_files',['source_path'],true],['ingestion_jobs',['source_path'],true],['review_items',['source_path','raw_source_path'],false],['visual_assets',['storage_path'],false]]) {
  const rows=(await db.query(`SELECT id,${columns.join(',')} FROM kb.${table}`)).rows;
  for(const row of rows) for(const column of columns)if(row[column]){const rel=relative(row[column]);paths.add(rel);const normalized=absolute?'/tmp/p2l-knowledge/'+rel:rel;if(normalized!==row[column])await db.query(`UPDATE kb.${table} SET ${column}=$1 WHERE id=$2`,[normalized,row.id]);}
 }
 for(const folder of ['.local-data/knowledge-pilots','.local-data/knowledge-assets']) {async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else paths.add(path.relative(backup,p).replaceAll('\\','/'));}}try{await walk(path.join(backup,folder));}catch{}}
 const existing=new Set((await db.query('SELECT path FROM kb.cloud_files')).rows.map(r=>r.path));
 await parallel([...paths],async rel=>{if(existing.has(rel)){counts.existing++;return;}let bytes;try{const stat=await fs.stat(path.join(backup,rel));if(stat.isDirectory())return;bytes=await bytesFor(rel);}catch{counts.missing.push(rel);return;}const reference=await store(bytes);await db.query('INSERT INTO kb.cloud_files(path,reference) VALUES($1,$2) ON CONFLICT(path) DO UPDATE SET reference=EXCLUDED.reference',[rel,reference]);counts.knowledgeFiles++;if(counts.knowledgeFiles%100===0)console.log('Knowledge source files verified',counts.knowledgeFiles);});
 await fs.writeFile(path.join(root,'outputs/newbackup-migration/files.json'),JSON.stringify(counts,null,2));console.log(JSON.stringify(counts));if(counts.missing.length)process.exitCode=1;
}finally{await db.end();}
