import { NextResponse } from 'next/server';

import {
  QueueValidationError,
  reorderQueueItems,
} from '@/lib/queue/service';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.ordered_ids)) {
      throw new QueueValidationError('ordered_ids must be an array.');
    }
    return NextResponse.json({
      data: await reorderQueueItems(body.ordered_ids),
      message: 'Runway order saved. Plan on calendar to recalculate future dates.',
    });
  } catch (error) {
    console.error('Failed to reorder sample queue:', error);
    if (error instanceof QueueValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'The queue order could not be saved.' },
      { status: 503 }
    );
  }
}
