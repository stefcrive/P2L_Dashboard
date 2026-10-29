import { NextResponse } from 'next/server';

import {
  createKnowledgeEngine,
  getKnowledgeEngines,
} from '@/lib/knowledge/engines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getKnowledgeEngines());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load engines.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; description?: string };
    return NextResponse.json(
      await createKnowledgeEngine(body.name ?? '', body.description ?? ''),
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create engine.' },
      { status: 400 }
    );
  }
}
