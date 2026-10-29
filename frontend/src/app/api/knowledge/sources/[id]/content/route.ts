import { hydrateKnowledgePath } from '@/lib/cloud/knowledge-files';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import {
  assertPathInsideRepository,
  getKnowledgeConfig,
} from '@/lib/knowledge/config';
import { getKnowledgeDatabase } from '@/lib/knowledge/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.pdf': 'application/pdf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const database = await getKnowledgeDatabase();
    const result = await database.query<{
      source_path: string;
      source_name: string;
    }>(`SELECT source_path, source_name FROM kb.sources WHERE id = $1`, [
      Number((await context.params).id),
    ]);
    const source = result.rows[0];
    if (!source) {
      return NextResponse.json(
        { error: 'Knowledge source not found.' },
        { status: 404 }
      );
    }

    const config = getKnowledgeConfig();
    const requestedPath = path.isAbsolute(source.source_path)
      ? source.source_path
      : path.resolve(config.repositoryRoot, source.source_path);
    await hydrateKnowledgePath(requestedPath);
    const sourcePath = assertPathInsideRepository(requestedPath);
    const contents = await fs.readFile(sourcePath);
    const extension = path.extname(source.source_name).toLowerCase();
    const disposition = ['.txt', '.md', '.csv', '.tsv', '.pdf'].includes(
      extension
    )
      ? 'inline'
      : 'attachment';

    return new NextResponse(Uint8Array.from(contents).buffer, {
      headers: {
        'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(
          source.source_name
        )}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to open source file.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
