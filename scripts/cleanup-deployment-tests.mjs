import fs from 'node:fs/promises';import {parseEnv} from 'node:util';import pg from 'pg';
const dir='../deployment-review-2026-10-27';const env=parseEnv(await fs.readFile('outputs/vercel-migration/production.env','utf8'));const db=new pg.Client({connectionString:env.DATABASE_URL});await db.connect();
try{await db.query('BEGIN');
 const records=JSON.parse(await fs.readFile(dir+'/p2l-new-test-records.json','utf8'));
 const queue=(await db.query('SELECT id,sample_label,lab_book_entry_id FROM sample_queue_items WHERE id=$1',[records.queueId])).rows[0];
 if(queue){if(queue.sample_label!=='Deployment Verification')throw new Error('Unexpected queue record');await db.query('DELETE FROM sample_queue_items WHERE id=$1',[queue.id]);if(queue.lab_book_entry_id)await db.query('DELETE FROM lab_book_entries WHERE id=$1 AND title=$2',[queue.lab_book_entry_id,'Deployment Verification']);}
 for(const id of new Set([records.clientId,records.resultClientId].filter(Boolean))){const row=(await db.query('SELECT name FROM clients WHERE id=$1',[id])).rows[0];if(row){if(row.name!=='Deployment Verification')throw new Error('Unexpected client record');await db.query('DELETE FROM clients WHERE id=$1',[id]);}}
 const knowledge=JSON.parse(await fs.readFile(dir+'/p2l-knowledge-test-records.json','utf8'));
 const relative=knowledge.sourcePath.replace('/tmp/p2l-knowledge/','');
 const job=(await db.query('SELECT source_path FROM kb.ingestion_jobs WHERE id=$1',[knowledge.jobId])).rows[0];
 if(job){if(job.source_path!==knowledge.sourcePath)throw new Error('Unexpected knowledge job');await db.query('DELETE FROM kb.ingestion_jobs WHERE id=$1',[knowledge.jobId]);}
 await db.query("DELETE FROM kb.sources WHERE source_path=$1 AND source_name='deployment-verification.pdf'",[relative+'/deployment-verification.pdf']);
 await db.query('DELETE FROM kb.cloud_files WHERE path=$1',[relative+'/deployment-verification.pdf']);
 await db.query('COMMIT');
 const expected=JSON.parse(await fs.readFile('outputs/newbackup-migration/cloud-counts.json','utf8'));const counts={};
 for(const table of Object.keys(expected)){counts[table]=Number((await db.query('SELECT count(*) FROM '+table)).rows[0].count);if(counts[table]!==expected[table] && table!=='public.backup_records' && table!=='kb.query_traces')throw new Error('Unexpected remaining count '+table+': '+counts[table]+' != '+expected[table]);}
 counts.privateKnowledgeFiles=Number((await db.query('SELECT count(*) FROM kb.cloud_files')).rows[0].count);counts.privateClientDocuments=Number((await db.query("SELECT count(*) FROM client_documents WHERE absolute_path LIKE 'blob://%'")).rows[0].count);
 await fs.writeFile(dir+'/final-hosted-data-counts.json',JSON.stringify(counts,null,2));console.log(JSON.stringify(counts));
}catch(e){await db.query('ROLLBACK');console.error(e.message);process.exitCode=1;}finally{await db.end();}
