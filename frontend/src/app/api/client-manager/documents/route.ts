import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
} from '@/lib/client-manager/types';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'document';
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const clientId = String(formData.get('clientId') ?? '').trim();
    const file = formData.get('file');
    const rawCategory = String(formData.get('category') ?? 'other');
    const category: DocumentCategory = DOCUMENT_CATEGORIES.includes(
      rawCategory as DocumentCategory
    )
      ? (rawCategory as DocumentCategory)
      : 'other';
    const parsedYear = Number.parseInt(String(formData.get('year') ?? ''), 10);

    if (!clientId || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: 'Choose a client and a non-empty document.' },
        { status: 400 }
      );
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Documents are limited to 25 MB per upload.' },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = safeFileName(file.name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const relativePath = `database/${clientId}/${timestamp}-${fileName}`;
    const extensionMatch = fileName.match(/(\.[^.]+)$/);
    const extension = extensionMatch?.[1]?.toLowerCase() ?? '';
    const database = getSupabaseAdminClient();
    const { data, error } = await database
      .from('client_documents')
      .insert({
        client_id: clientId,
        file_name: fileName,
        relative_path: relativePath,
        absolute_path: `database://${relativePath}`,
        year: Number.isInteger(parsedYear) ? parsedYear : null,
        extension,
        category,
        inferred_document_number: null,
        inferred_document_date: null,
        file_size_bytes: bytes.byteLength,
        mime_type: file.type || 'application/octet-stream',
        content_sha256: createHash('sha256').update(bytes).digest('hex'),
        content:
          getApplicationDatabaseSource() === 'supabase'
            ? `\\x${Buffer.from(bytes).toString('hex')}`
            : bytes,
        storage_origin: 'upload',
      })
      .select(
        'id, client_id, file_name, relative_path, absolute_path, year, extension, category, inferred_document_number, inferred_document_date, file_size_bytes, mime_type, content_sha256, storage_origin, created_at, updated_at'
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Unable to store document: ${error.message}` },
        { status: 500 }
      );
    }

    const { count } = await database
      .from('client_documents')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId);
    await database
      .from('clients')
      .update({ total_documents: count ?? 0 })
      .eq('id', clientId);

    return NextResponse.json(
      { message: 'Document stored in the database.', document: data },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to upload document.',
      },
      { status: 500 }
    );
  }
}
