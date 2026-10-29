import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { put, get } from '@vercel/blob';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env=parseEnv(await fs.readFile(path.join(root,'outputs/vercel-migration/production.env'),'utf8'));
Object.assign(process.env,env);
const client=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL});
await client.connect();
try {
 const {rows}=await client.query('SELECT id,file_name,absolute_path,relative_path,content,content_sha256 FROM client_documents');
 const counts={total:rows.length,migrated:0,existing:0,missing:0};
 for(const row of rows){
  if(row.absolute_path.startsWith('blob://')){counts.existing++;continue;}
  let bytes=row.content;
  if(!bytes){
   const candidates=[row.absolute_path,path.join(root,row.relative_path),path.join(root,'Clienti',row.relative_path)];
   for(const candidate of candidates){try{bytes=await fs.readFile(candidate);break;}catch{}}
  }
  if(!bytes){counts.missing++;continue;}
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(row.content_sha256 && row.content_sha256!==digest) throw new Error('Source document integrity mismatch for '+row.id);
  await put('documents/'+digest,bytes,{access:'private',addRandomSuffix:false,allowOverwrite:true});
  const downloaded=await get('documents/'+digest,{access:'private'});
  const verified=Buffer.from(await new Response(downloaded.stream).arrayBuffer());
  if(!verified.equals(bytes))throw new Error('Cloud document verification failed.');
  await client.query('UPDATE client_documents SET absolute_path=$1,content_sha256=$2,content=NULL WHERE id=$3',['blob://'+digest,digest,row.id]);
  counts.migrated++;
 }
 console.log(JSON.stringify(counts));
 await fs.writeFile(path.join(root,'outputs/vercel-migration/documents.json'),JSON.stringify(counts,null,2));
 if(counts.missing)process.exitCode=1;
}finally{await client.end();}
