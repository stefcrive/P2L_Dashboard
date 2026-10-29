import { NextResponse } from 'next/server';

import { processJobStep } from '@/lib/knowledge/ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = Number.parseInt((await context.params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid job id.' }, { status: 400 });
  }
  try {
    return NextResponse.json(await processJobStep(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process job.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
