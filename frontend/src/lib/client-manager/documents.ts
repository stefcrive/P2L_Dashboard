import 'server-only';

import { createHash } from 'node:crypto';
import { cloudEnabled } from '@/lib/cloud/database';
import { storeCloudDocument } from '@/lib/cloud/files';

import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
} from '@/lib/client-manager/types';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const MAX_CLIENT_DOCUMENT_BYTES = 25 * 1024 * 1024;

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'document';
}

export function normalizeDocumentCategory(value: unknown): DocumentCategory {
  const category = String(value ?? 'other');
  return DOCUMENT_CATEGORIES.includes(category as DocumentCategory)
    ? (category as DocumentCategory)
    : 'other';
}

export async function storeClientDocument({
  clientId,
  file,
  category = 'other',
  year = new Date().getFullYear(),
}: {
  clientId: string;
  file: File;
  category?: DocumentCategory;
  year?: number | null;
}) {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId || file.size === 0) {
    throw new Error('Choose a client and a non-empty document.');
  }
  if (file.size > MAX_CLIENT_DOCUMENT_BYTES) {
    throw new Error('Documents are limited to 25 MB per upload.');
  }

  const database = getSupabaseAdminClient();
  const { data: client, error: clientError } = await database
    .from('clients')
    .select('id, name')
    .eq('id', normalizedClientId)
    .maybeSingle();
  if (clientError) throw new Error(`Unable to load client: ${clientError.message}`);
  if (!client) throw new Error('Client not found.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = safeFileName(file.name);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relativePath = `database/${normalizedClientId}/${timestamp}-${fileName}`;
  const extensionMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? '';
  const cloudPath = cloudEnabled() ? await storeCloudDocument(bytes) : null;
  const { data, error } = await database
    .from('client_documents')
    .insert({
      client_id: normalizedClientId,
      file_name: fileName,
      relative_path: relativePath,
      absolute_path: cloudPath ?? `database://${relativePath}`,
      year: Number.isInteger(year) ? year : null,
      extension,
      category,
      inferred_document_number: null,
      inferred_document_date: null,
      file_size_bytes: bytes.byteLength,
      mime_type: file.type || 'application/octet-stream',
      content_sha256: createHash('sha256').update(bytes).digest('hex'),
      content:
        cloudPath ? null : getApplicationDatabaseSource() === 'supabase'
          ? `\\x${Buffer.from(bytes).toString('hex')}`
          : bytes,
      storage_origin: 'upload',
    })
    .select(
      'id, client_id, file_name, relative_path, absolute_path, year, extension, category, inferred_document_number, inferred_document_date, file_size_bytes, mime_type, content_sha256, storage_origin, created_at, updated_at'
    )
    .single();
  if (error) throw new Error(`Unable to store document: ${error.message}`);

  const { count } = await database
    .from('client_documents')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', normalizedClientId);
  await database
    .from('clients')
    .update({ total_documents: count ?? 0 })
    .eq('id', normalizedClientId);

  return {
    ...data,
    client_name: String(client.name),
  };
}
