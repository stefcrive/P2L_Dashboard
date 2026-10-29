import { NextResponse } from 'next/server';

import {
  getReviewQueue,
  type AutoTriageFilter,
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
const VALID_AUTO_STATES = new Set<AutoTriageFilter>([
  'untriaged',
  'assessed',
  'kept',
  'quarantined',
  'needs_review',
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get('status') ?? 'pending';
    const requestedAutoState = url.searchParams.get('autoState');
    const requestedJobId = Number(url.searchParams.get('jobId'));
    const status = VALID_STATUSES.has(requestedStatus as ReviewStatus | 'all')
      ? (requestedStatus as ReviewStatus | 'all')
      : 'pending';
    return NextResponse.json(
      await getReviewQueue({
        status,
        search: url.searchParams.get('search') ?? '',
        reason: url.searchParams.get('reason') ?? '',
        autoState: VALID_AUTO_STATES.has(requestedAutoState as AutoTriageFilter)
          ? (requestedAutoState as AutoTriageFilter)
          : undefined,
        jobId:
          Number.isSafeInteger(requestedJobId) && requestedJobId > 0
            ? requestedJobId
            : undefined,
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
