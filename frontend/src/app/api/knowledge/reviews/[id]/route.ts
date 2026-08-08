import { NextResponse } from 'next/server';

import {
  getReviewItem,
  type ReviewStatus,
  updateReviewItem,
} from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set<ReviewStatus>([
  'pending',
  'kept',
  'quarantined',
  'skipped',
]);

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  try {
    const result = await getReviewItem(Number(context.params.id));
    if (!result) {
      return NextResponse.json(
        { error: 'Review item not found.' },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to load review item.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { status?: ReviewStatus; reviewerNote?: string }
      | null;
    if (!body?.status || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: 'A valid review status is required.' },
        { status: 400 }
      );
    }
    const updated = await updateReviewItem(
      Number(context.params.id),
      body.status,
      body.reviewerNote ?? ''
    );
    if (!updated) {
      return NextResponse.json(
        { error: 'Review item not found.' },
        { status: 404 }
      );
    }
    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to save review.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
