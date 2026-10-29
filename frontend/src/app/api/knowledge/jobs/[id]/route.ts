import { NextResponse } from 'next/server';

import {
  controlIngestionJob,
  deleteCancelledIngestionJob,
  updateIngestionJobConfiguration,
} from '@/lib/knowledge/ingestion';
import { getKnowledgeDatabase } from '@/lib/knowledge/db';
import type { IngestionMode } from '@/lib/knowledge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jobIdFrom(params: { id: string }) {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid job id.');
  return id;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const id = jobIdFrom(await context.params);
    const database = await getKnowledgeDatabase();
    const [job, files] = await Promise.all([
      database.query(
        `SELECT id::text, status, stage, mode, source_path,
                technical_review_enabled, enrichment_model,
                embedding_model, embedding_dimensions, chunk_target_tokens,
                chunk_overlap_tokens, total_files, processed_files, skipped_files,
                failed_files, total_messages, total_chunks, embedded_chunks,
                current_file, last_error, warnings, started_at, heartbeat_at,
                finished_at, created_at
         FROM kb.ingestion_jobs WHERE id = $1`,
        [id]
      ),
      database.query(
        `SELECT id::text, source_name, source_path, byte_size, sha256, status, stage,
                message_count, chunk_count, embedded_chunks, warning_count,
                error, started_at, finished_at
         FROM kb.job_files WHERE job_id = $1 ORDER BY id`,
        [id]
      ),
    ]);
    if (!job.rows[0])
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ job: job.rows[0], files: files.rows });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to load job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const id = jobIdFrom(await context.params);
    const body = (await request.json().catch(() => null)) as {
      action?: 'pause' | 'resume' | 'cancel' | 'restore';
      mode?: IngestionMode;
      engineId?: number | null;
      technicalReviewEnabled?: boolean;
      enrichmentModel?: string;
      embeddingModel?: string;
    } | null;
    if (body?.action) {
      if (!['pause', 'resume', 'cancel', 'restore'].includes(body.action)) {
        return NextResponse.json(
          { error: 'A valid job action is required.' },
          { status: 400 }
        );
      }
      return NextResponse.json(await controlIngestionJob(id, body.action));
    }
    if (
      !body ||
      (!body.mode &&
        body.engineId === undefined &&
        body.technicalReviewEnabled === undefined &&
        !body.enrichmentModel &&
        !body.embeddingModel)
    ) {
      return NextResponse.json(
        { error: 'Job settings are required.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      await updateIngestionJobConfiguration(id, {
        mode: body.mode,
        engineId: body.engineId,
        technicalReviewEnabled: body.technicalReviewEnabled,
        enrichmentModel: body.enrichmentModel,
        embeddingModel: body.embeddingModel,
      })
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to update job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const id = jobIdFrom(await context.params);
    return NextResponse.json(await deleteCancelledIngestionJob(id));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to delete job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
