import { NextResponse } from 'next/server';

import {
  importCleanupAudit,
  reconcileCleanupAuditPaths,
} from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('pathsOnly') === '1') {
      return NextResponse.json(await reconcileCleanupAuditPaths());
    }
    return NextResponse.json(await importCleanupAudit(), { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to import cleanup review records.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
