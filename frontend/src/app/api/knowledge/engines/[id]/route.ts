import { NextResponse } from 'next/server';

import { updateKnowledgeEngine } from '@/lib/knowledge/engines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      enabled?: boolean;
    };
    return NextResponse.json(
      await updateKnowledgeEngine(Number((await context.params).id), body)
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update engine.' },
      { status: 400 }
    );
  }
}
