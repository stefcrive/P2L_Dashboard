import { NextResponse } from 'next/server';

import { answerKnowledgeQuestion } from '@/lib/knowledge/retrieval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          question?: string;
          answerModel?: string;
          rerank?: boolean;
          engineIds?: unknown;
          thinking?: boolean;
        }
      | null;
    if (!body?.question?.trim()) {
      return NextResponse.json({ error: 'A technical question is required.' }, { status: 400 });
    }
    const engineIds = Array.isArray(body.engineIds)
      ? body.engineIds
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0)
      : undefined;
    if (body.engineIds !== undefined && !engineIds?.length) {
      return NextResponse.json(
        { error: 'Select at least one active knowledge engine.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      await answerKnowledgeQuestion({
        question: body.question,
        answerModel: body.answerModel,
        rerank: body.rerank,
        engineIds,
        thinking: body.thinking,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to answer the knowledge question.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
