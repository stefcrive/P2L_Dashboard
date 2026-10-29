import { promises as fs } from 'node:fs';
import { hydrateKnowledgePath } from '@/lib/cloud/knowledge-files';
import path from 'node:path';

import { NextResponse } from 'next/server';

import {
  assertPathInsideRepository,
  getKnowledgeConfig,
} from '@/lib/knowledge/config';
import { getKnowledgeDatabase } from '@/lib/knowledge/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const visualId = Number((await context.params).id);
    if (!Number.isSafeInteger(visualId) || visualId <= 0) {
      return NextResponse.json({ error: 'Invalid visual ID.' }, { status: 400 });
    }
    const database = await getKnowledgeDatabase();
    const result = await database.query<{
      storage_path: string;
      mime_type: string;
      sha256: string;
    }>(
      `SELECT storage_path, mime_type, sha256
       FROM kb.visual_assets WHERE id = $1`,
      [visualId]
    );
    const visual = result.rows[0];
    if (!visual) {
      return NextResponse.json(
        { error: 'Visual evidence not found.' },
        { status: 404 }
      );
    }
    const config = getKnowledgeConfig();
    const requestedPath = path.isAbsolute(visual.storage_path)
      ? visual.storage_path
      : path.resolve(config.repositoryRoot, visual.storage_path);
    await hydrateKnowledgePath(requestedPath);
    const visualPath = assertPathInsideRepository(requestedPath);
    const contents = await fs.readFile(visualPath);
    return new NextResponse(Uint8Array.from(contents).buffer, {
      headers: {
        'Content-Type': visual.mime_type,
        'Content-Disposition': `inline; filename="visual-${visualId}.png"`,
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: `"${visual.sha256}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to open visual evidence.',
      },
      { status: 400 }
    );
  }
}
