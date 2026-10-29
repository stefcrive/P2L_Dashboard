import { NextResponse } from 'next/server';

import { processAutoTriageBatch } from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      limit?: number;
      jobId?: number;
    } | null;
    return NextResponse.json(
      await processAutoTriageBatch(
        Number(body?.limit ?? 16),
        Number(body?.jobId)
      )
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to auto-triage messages.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
