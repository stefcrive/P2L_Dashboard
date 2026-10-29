import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { resolveClientiRootPath } from '@/lib/client-manager/paths';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCloudDocument } from '@/lib/cloud/files';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

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

export async function GET(_request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
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
  if (!bytes && data.absolute_path?.startsWith('blob://')) {
    bytes = await readCloudDocument(data.absolute_path);
  }
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

export async function DELETE(_request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  try {
    const database = getSupabaseAdminClient();
    const { data: document, error: readError } = await database
      .from('client_documents')
      .select('id, client_id, file_name, storage_origin')
      .eq('id', params.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!document) {
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    }
    if (document.storage_origin !== 'upload') {
      return NextResponse.json(
        {
          error:
            'Indexed folder files cannot be removed here. Remove the source file and run sync instead.',
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await database
      .from('client_documents')
      .delete()
      .eq('id', params.id);
    if (deleteError) throw new Error(deleteError.message);

    const { count } = await database
      .from('client_documents')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', document.client_id);
    await database
      .from('clients')
      .update({ total_documents: count ?? 0 })
      .eq('id', document.client_id);

    return NextResponse.json({
      message: `${String(document.file_name)} removed.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to remove document.',
      },
      { status: 500 }
    );
  }
}
