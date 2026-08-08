import { NextResponse } from 'next/server';

import { updateReviewItemsBulk } from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          ids?: unknown[];
          status?: 'kept' | 'quarantined';
          reviewerNote?: string;
        }
      | null;
    if (
      !body ||
      !Array.isArray(body.ids) ||
      !body.ids.length ||
      !['kept', 'quarantined'].includes(body.status ?? '')
    ) {
      return NextResponse.json(
        { error: 'Select messages and choose Keep or Quarantine.' },
        { status: 400 }
      );
    }
    const ids = body.ids.map(Number);
    if (ids.length > 200 || ids.some((id) => !Number.isSafeInteger(id))) {
      return NextResponse.json(
        { error: 'Bulk decisions are limited to 200 valid messages.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      await updateReviewItemsBulk(
        ids,
        body.status as 'kept' | 'quarantined',
        body.reviewerNote ?? ''
      )
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to save bulk decision.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
