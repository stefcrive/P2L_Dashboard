import { NextResponse } from 'next/server';

import { getKnowledgeDatabase } from '@/lib/knowledge/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const id = Number.parseInt((await context.params).id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid source id.' }, { status: 400 });
  }
  try {
    const database = await getKnowledgeDatabase();
    const result = await database.query<{ id: string; source_name: string }>(
      `DELETE FROM kb.sources WHERE id = $1
       RETURNING id::text, source_name`,
      [id],
    );
    if (!result.rows[0]) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 });
    }
    return NextResponse.json({
      removed: result.rows[0],
      recoverable: 'The raw file was not deleted and can be re-ingested.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to remove source.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
