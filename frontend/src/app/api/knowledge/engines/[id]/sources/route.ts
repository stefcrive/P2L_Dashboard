import { NextResponse } from 'next/server';

import { setEngineSource } from '@/lib/knowledge/engines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = (await request.json()) as {
      sourceId?: number;
      included?: boolean;
      enabled?: boolean;
    };
    if (!Number.isSafeInteger(Number(body.sourceId))) {
      throw new Error('A valid source is required.');
    }
    return NextResponse.json(
      await setEngineSource({
        engineId: Number((await context.params).id),
        sourceId: Number(body.sourceId),
        included: body.included !== false,
        enabled: body.enabled,
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update source.' },
      { status: 400 }
    );
  }
}
