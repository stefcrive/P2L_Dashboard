import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { resolveClientiRootPath } from '@/lib/client-manager/paths';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

function decodeBytea(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string' && value.startsWith('\\x')) {
    return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
  }
  if (typeof value === 'string' && value) {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  return null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const database = getSupabaseAdminClient();
  const { data, error } = await database
    .from('client_documents')
    .select('file_name, absolute_path, mime_type, content')
    .eq('id', params.id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  let bytes = decodeBytea(data.content);
  if (!bytes && typeof data.absolute_path === 'string') {
    const clientiRoot = path.resolve(await resolveClientiRootPath());
    const candidate = path.resolve(data.absolute_path);
    const relative = path.relative(clientiRoot, candidate);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      bytes = new Uint8Array(await readFile(candidate));
    }
  }
  if (!bytes) {
    return NextResponse.json(
      { error: 'This document has no stored content. Run Clienti sync again.' },
      { status: 404 }
    );
  }

  const fileName = String(data.file_name ?? 'document').replace(/["\r\n]/g, '_');
  const responseBody = new Uint8Array(bytes).buffer;
  return new Response(responseBody, {
    headers: {
      'Content-Type': String(data.mime_type ?? 'application/octet-stream'),
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
