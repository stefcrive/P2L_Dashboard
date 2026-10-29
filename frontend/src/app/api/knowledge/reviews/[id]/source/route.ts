import { promises as fs } from 'node:fs';

import { NextResponse } from 'next/server';

import { getReviewSource } from '@/lib/knowledge/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const source = await getReviewSource(Number((await context.params).id));
    if (!source) {
      return NextResponse.json(
        { error: 'Review source not found.' },
        { status: 404 }
      );
    }
    const contents = await fs.readFile(source.path);
    return new NextResponse(Uint8Array.from(contents).buffer, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(
          source.sourceName
        )}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to open review source.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
