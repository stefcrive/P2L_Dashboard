import { NextResponse } from 'next/server';

import { hybridRetrieve } from '@/lib/knowledge/retrieval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const question = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (!question) {
      return NextResponse.json({ error: 'A search query is required.' }, { status: 400 });
    }
    if (question.length > 2_000) {
      return NextResponse.json({ error: 'Search queries are limited to 2,000 characters.' }, { status: 400 });
    }
    return NextResponse.json({ evidence: (await hybridRetrieve(question, 40)).slice(0, 20) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to search knowledge evidence.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
