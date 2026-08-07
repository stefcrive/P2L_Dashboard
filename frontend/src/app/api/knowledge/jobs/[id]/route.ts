import { NextResponse } from 'next/server';

import { controlIngestionJob } from '@/lib/knowledge/ingestion';
import { getKnowledgeDatabase } from '@/lib/knowledge/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jobIdFrom(params: { id: string }) {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid job id.');
  return id;
}

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  try {
    const id = jobIdFrom(context.params);
    const database = await getKnowledgeDatabase();
    const [job, files] = await Promise.all([
      database.query(
        `SELECT id::text, status, stage, mode, source_path, enrichment_model,
                embedding_model, embedding_dimensions, chunk_target_tokens,
                chunk_overlap_tokens, total_files, processed_files, skipped_files,
                failed_files, total_messages, total_chunks, embedded_chunks,
                current_file, last_error, warnings, started_at, heartbeat_at,
                finished_at, created_at
         FROM kb.ingestion_jobs WHERE id = $1`,
        [id],
      ),
      database.query(
        `SELECT id::text, source_name, source_path, byte_size, sha256, status, stage,
                message_count, chunk_count, embedded_chunks, warning_count,
                error, started_at, finished_at
         FROM kb.job_files WHERE job_id = $1 ORDER BY id`,
        [id],
      ),
    ]);
    if (!job.rows[0]) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ job: job.rows[0], files: files.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  try {
    const id = jobIdFrom(context.params);
    const body = (await request.json().catch(() => null)) as {
      action?: 'pause' | 'resume' | 'cancel';
    } | null;
    if (!body?.action || !['pause', 'resume', 'cancel'].includes(body.action)) {
      return NextResponse.json({ error: 'A valid job action is required.' }, { status: 400 });
    }
    return NextResponse.json(await controlIngestionJob(id, body.action));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
