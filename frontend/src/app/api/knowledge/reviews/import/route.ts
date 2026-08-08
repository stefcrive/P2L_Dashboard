import { NextResponse } from 'next/server';

import { importCleanupAudit } from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return NextResponse.json(await importCleanupAudit(), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to import cleanup review records.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
