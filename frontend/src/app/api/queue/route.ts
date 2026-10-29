import { NextResponse } from 'next/server';

import {
  createQueueItem,
  deleteQueueItem,
  listQueueItems,
  QueueValidationError,
  updateQueueItem,
} from '@/lib/queue/service';
import { getApplicationDatabaseSource } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    return NextResponse.json({
      data: await listQueueItems(),
      source: getApplicationDatabaseSource(),
    });
  } catch (error) {
    console.error('Failed to read sample queue:', error);
    return apiError('The sample queue is unavailable. Restart the application and try again.', 503);
  }
}

export async function POST(request: Request) {
  try {
    const result = await createQueueItem(await request.json());
    return NextResponse.json(
      { ...result, message: 'Samples checked in.' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to check in samples:', error);
    if (error instanceof QueueValidationError) return apiError(error.message, 400);
    return apiError('The samples could not be checked in.', 503);
  }
}

export async function PATCH(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const result = await updateQueueItem(id, await request.json());
    return NextResponse.json({ ...result, message: 'Queue item updated.' });
  } catch (error) {
    console.error('Failed to update sample queue:', error);
    if (error instanceof QueueValidationError) return apiError(error.message, 400);
    return apiError('The queue item could not be updated.', 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    await deleteQueueItem(id);
    return NextResponse.json({ message: 'Queue item removed.' });
  } catch (error) {
    console.error('Failed to remove sample queue item:', error);
    if (error instanceof QueueValidationError) return apiError(error.message, 400);
    return apiError('The queue item could not be removed.', 503);
  }
}
