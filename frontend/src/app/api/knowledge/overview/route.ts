import { NextResponse } from 'next/server';

import { getKnowledgeOverview } from '@/lib/knowledge/ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getKnowledgeOverview());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to load the knowledge database.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
