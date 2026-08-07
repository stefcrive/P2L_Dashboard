import { NextResponse } from 'next/server';

import { answerKnowledgeQuestion } from '@/lib/knowledge/retrieval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { question?: string; answerModel?: string; rerank?: boolean }
      | null;
    if (!body?.question?.trim()) {
      return NextResponse.json({ error: 'A technical question is required.' }, { status: 400 });
    }
    return NextResponse.json(
      await answerKnowledgeQuestion({
        question: body.question,
        answerModel: body.answerModel,
        rerank: body.rerank,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to answer the knowledge question.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
