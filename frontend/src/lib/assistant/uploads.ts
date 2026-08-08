import 'server-only';

import { createHash } from 'node:crypto';

import { storeClientDocument } from '@/lib/client-manager/documents';
import type { DocumentCategory } from '@/lib/client-manager/types';
import { importResultFile, type ResultClient } from '@/lib/results/importer';
import { parseResultFileName, parseResultWorkbook } from '@/lib/results/parser';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export type AssistantUpload = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
  attachedDocumentId: string | null;
};

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

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'attachment';
}

function uploadFromRow(row: Record<string, unknown>): AssistantUpload | null {
  const bytes = decodeBytea(row.content);
  if (!bytes) return null;
  return {
    id: String(row.id),
    fileName: String(row.file_name ?? 'attachment'),
    mimeType: String(row.mime_type ?? 'application/octet-stream'),
    size: Number(row.file_size_bytes ?? bytes.byteLength),
    bytes,
    attachedDocumentId: row.attached_document_id
      ? String(row.attached_document_id)
      : null,
  };
}

export async function stageAssistantUpload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = safeFileName(file.name);
  const database = getSupabaseAdminClient();
  const { data, error } = await database
    .from('assistant_uploads')
    .insert({
      file_name: fileName,
      mime_type: file.type || 'application/octet-stream',
      file_size_bytes: bytes.byteLength,
      content_sha256: createHash('sha256').update(bytes).digest('hex'),
      content:
        getApplicationDatabaseSource() === 'supabase'
          ? `\\x${Buffer.from(bytes).toString('hex')}`
          : bytes,
    })
    .select('id, file_name, mime_type, file_size_bytes, attached_document_id')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? `Unable to retain ${fileName}.`);
  }
  return {
    id: String(data.id),
    fileName: String(data.file_name),
    mimeType: String(data.mime_type),
    size: Number(data.file_size_bytes),
    attachedDocumentId: data.attached_document_id
      ? String(data.attached_document_id)
      : null,
  };
}

export async function loadAssistantUploads(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map<string, AssistantUpload>();
  const database = getSupabaseAdminClient();
  const { data, error } = await database
    .from('assistant_uploads')
    .select(
      'id, file_name, mime_type, file_size_bytes, content, attached_document_id'
    )
    .in('id', uniqueIds);
  if (error) throw new Error(`Unable to load assistant uploads: ${error.message}`);
  const uploads = new Map<string, AssistantUpload>();
  for (const row of data ?? []) {
    const upload = uploadFromRow(row);
    if (upload) uploads.set(upload.id, upload);
  }
  return uploads;
}

async function loadAssistantUpload(id: string) {
  const uploads = await loadAssistantUploads([id]);
  const upload = uploads.get(id);
  if (!upload) throw new Error('The uploaded file is no longer available.');
  return upload;
}

async function loadClient(clientId: string): Promise<ResultClient> {
  const database = getSupabaseAdminClient();
  const { data, error } = await database
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Unable to load client: ${error.message}`);
  if (!data) throw new Error('Client not found.');
  return { id: String(data.id), name: String(data.name) };
}

export async function attachAssistantUploadToClient(args: Record<string, unknown>) {
  const uploadId = String(args.upload_id ?? '').trim();
  const clientId = String(args.client_id ?? '').trim();
  if (!uploadId) throw new Error('upload_id is required.');
  if (!clientId) throw new Error('client_id is required.');

  const upload = await loadAssistantUpload(uploadId);
  const client = await loadClient(clientId);
  if (upload.attachedDocumentId) {
    const database = getSupabaseAdminClient();
    const { data: document } = await database
      .from('client_documents')
      .select('id, client_id, file_name, category')
      .eq('id', upload.attachedDocumentId)
      .maybeSingle();
    if (document?.client_id === clientId) {
      return {
        success: true,
        action: 'already_attached',
        client,
        document,
      };
    }
    if (document) {
      throw new Error(
        'This upload is already attached to another client. Reassign its document record explicitly.'
      );
    }
  }

  const fileBuffer = new ArrayBuffer(upload.bytes.byteLength);
  new Uint8Array(fileBuffer).set(upload.bytes);
  const file = new File([fileBuffer], upload.fileName, {
    type: upload.mimeType,
  });
  const category = String(args.category ?? 'other');
  const allowedCategories = new Set([
    'quote',
    'invoice',
    'payment_slip',
    'payment_receipt',
    'credit',
    'purchase_order',
    'shipping',
    'analysis',
    'other',
  ]);
  const requestedYear = Number(args.year);
  const document = await storeClientDocument({
    clientId,
    file,
    category: (allowedCategories.has(category) ? category : 'other') as DocumentCategory,
    year: Number.isInteger(requestedYear) ? requestedYear : null,
  });
  await getSupabaseAdminClient()
    .from('assistant_uploads')
    .update({ attached_document_id: document.id })
    .eq('id', uploadId);
  return { success: true, action: 'attached_upload', client, document };
}

export async function importAssistantResultUpload(args: Record<string, unknown>) {
  const uploadId = String(args.upload_id ?? '').trim();
  const clientId = String(args.client_id ?? '').trim();
  if (!uploadId) throw new Error('upload_id is required.');
  if (!clientId) throw new Error('client_id is required.');

  const upload = await loadAssistantUpload(uploadId);
  if (!/\.(xlsx|xls)$/i.test(upload.fileName)) {
    throw new Error('Result imports require an .xlsx or .xls upload.');
  }
  const client = await loadClient(clientId);
  const metadata = parseResultFileName(upload.fileName);
  const parsed = parseResultWorkbook(upload.bytes, upload.fileName);
  const relativePath = `Results/assistant/${uploadId}-${upload.fileName}`;
  const imported = await importResultFile({
    client,
    bytes: upload.bytes,
    metadata,
    parsed,
    relativePath,
    absolutePath: `database://${relativePath}`,
    storageOrigin: 'upload',
  });
  await getSupabaseAdminClient()
    .from('assistant_uploads')
    .update({ attached_document_id: imported.documentId })
    .eq('id', uploadId);
  return {
    success: true,
    action: 'imported_result_upload',
    client,
    fileName: upload.fileName,
    ...imported,
  };
}
