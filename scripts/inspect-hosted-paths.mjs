import fs from 'node:fs/promises';import {parseEnv} from 'node:util';import pg from 'pg';
const env=parseEnv(await fs.readFile('outputs/vercel-migration/production.env','utf8'));const c=new pg.Client({connectionString:env.DATABASE_URL});await c.connect();
for(const [table,column] of [['kb.job_files','source_path'],['kb.ingestion_jobs','source_path'],['kb.review_items','raw_source_path'],['public.client_documents','absolute_path']])console.log(table,(await c.query(`SELECT DISTINCT ${column} FROM ${table} LIMIT 4`)).rows);
console.log('Queue attachment count',(await c.query("SELECT sum(jsonb_array_length(attachments)) FROM sample_queue_items")).rows);
console.log('DB size',(await c.query('SELECT pg_database_size(current_database())')).rows);
await c.end();
