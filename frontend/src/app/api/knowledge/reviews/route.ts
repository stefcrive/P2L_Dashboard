import { NextResponse } from 'next/server';

import {
  getReviewQueue,
  type ReviewStatus,
} from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set<ReviewStatus | 'all'>([
  'all',
  'pending',
  'kept',
  'quarantined',
  'skipped',
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get('status') ?? 'pending';
    const status = VALID_STATUSES.has(
      requestedStatus as ReviewStatus | 'all'
    )
      ? (requestedStatus as ReviewStatus | 'all')
      : 'pending';
    return NextResponse.json(
      await getReviewQueue({
        status,
        search: url.searchParams.get('search') ?? '',
        reason: url.searchParams.get('reason') ?? '',
        limit: Number(url.searchParams.get('limit') ?? 25),
        offset: Number(url.searchParams.get('offset') ?? 0),
      })
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to load review queue.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
