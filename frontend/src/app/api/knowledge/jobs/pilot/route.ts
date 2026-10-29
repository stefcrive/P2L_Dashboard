import { NextResponse } from 'next/server';

import { getKnowledgeConfig } from '@/lib/knowledge/config';
import { getKnowledgeDatabase } from '@/lib/knowledge/db';
import { createIngestionJob } from '@/lib/knowledge/ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const database = await getKnowledgeDatabase();
    const engine = await database.query<{ id: number }>(
      `SELECT id FROM kb.engines WHERE system_key = 'isogeochem' LIMIT 1`
    );
    if (!engine.rows[0]) throw new Error('Isogeochem knowledge engine is unavailable.');
    const config = getKnowledgeConfig();
    const result = await createIngestionJob({
      sourcePath: '.local-data/knowledge-pilots/isogeochem_raw_pilot_20.txt',
      engineId: Number(engine.rows[0].id),
      mode: 'indexed',
      enrichmentModel: config.enrichmentModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      technicalReviewEnabled: true,
      chunkTargetTokens: 320,
      chunkOverlapTokens: 50,
    });
    return NextResponse.json(
      { ...result, engineName: 'Isogeochem knowledge engine', pilotFiles: 1 },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to prepare pilot job.' },
      { status: 400 }
    );
  }
}
