import { NextResponse } from 'next/server';

import { getKnowledgeConfig } from '@/lib/knowledge/config';
import { createIngestionJob } from '@/lib/knowledge/ingestion';
import type { IngestionMode } from '@/lib/knowledge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          sourcePath?: string;
          mode?: IngestionMode;
          enrichmentModel?: string;
          embeddingModel?: string;
          chunkTargetTokens?: number;
          chunkOverlapTokens?: number;
          engineId?: number;
          technicalReviewEnabled?: boolean;
        }
      | null;
    const config = getKnowledgeConfig();
    const result = await createIngestionJob({
      sourcePath: body?.sourcePath?.trim() || config.defaultSourcePath,
      engineId: body?.engineId ? Number(body.engineId) : null,
      mode: body?.mode ?? 'indexed',
      enrichmentModel: body?.enrichmentModel?.trim() || config.enrichmentModel,
      embeddingModel: body?.embeddingModel?.trim() || config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      technicalReviewEnabled: body?.technicalReviewEnabled === true,
      chunkTargetTokens: Number(body?.chunkTargetTokens ?? 320),
      chunkOverlapTokens: Number(body?.chunkOverlapTokens ?? 50),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create ingestion job.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
