import { cloudEnabled } from '@/lib/cloud/database';
import { storeCloudDocument, readCloudDocument } from '@/lib/cloud/files';
import { readUploadForm } from '@/lib/cloud/upload-form';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type QueueAttachment = {
  id: string;
  name: string;
  stored_name: string;
  blob_reference?: string;
  type: string;
  size: number;
  uploaded_at: string;
};

const acceptedExtensions = new Set(['.csv', '.xlsx', '.xls', '.txt', '.pdf']);
const maxFileSize = 15 * 1024 * 1024;

function repositoryRoot() {
  return process.cwd().endsWith(`${path.sep}frontend`)
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function queueDirectory(queueId: string) {
  if (!/^[0-9a-f-]{20,}$/i.test(queueId)) throw new Error('Invalid queue id.');
  return path.resolve(repositoryRoot(), '.local-data', 'queue-files', queueId);
}

function normalizeAttachments(value: unknown): QueueAttachment[] {
  if (Array.isArray(value)) return value as QueueAttachment[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as QueueAttachment[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function queueRecord(id: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await (supabase.from('sample_queue_items') as any)
    .select('id, attachments')
    .eq('id', id)
    .single();
  if (error || !data) throw error ?? new Error('Queue item not found.');
  return data;
}

export async function POST(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  try {
    const formData = await readUploadForm(request);
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a sample list file.' }, { status: 400 });
    }
    const extension = path.extname(file.name).toLowerCase();
    if (!acceptedExtensions.has(extension)) {
      return NextResponse.json(
        { error: 'Attach a CSV, Excel, text, or PDF sample list.' },
        { status: 400 }
      );
    }
    if (file.size > maxFileSize) {
      return NextResponse.json(
        { error: 'Sample list files must be 15 MB or smaller.' },
        { status: 400 }
      );
    }

    const record = await queueRecord(params.id);
    const attachments = normalizeAttachments(record.attachments);
    const attachmentId = randomUUID();
    const storedName = `${attachmentId}${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blobReference = cloudEnabled() ? await storeCloudDocument(bytes) : undefined;
    if (!cloudEnabled()) {
    const directory = queueDirectory(params.id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, storedName),
      bytes
    );
    }

    const attachment: QueueAttachment = {
      id: attachmentId,
      name: path.basename(file.name),
      stored_name: storedName,
      blob_reference: blobReference,
      type: file.type || 'application/octet-stream',
      size: file.size,
      uploaded_at: new Date().toISOString(),
    };
    const updatedAttachments = [...attachments, attachment];
    const supabase = getSupabaseAdminClient();
    const { error } = await (supabase.from('sample_queue_items') as any)
      .update({ attachments: updatedAttachments })
      .eq('id', params.id);
    if (error) throw error;

    return NextResponse.json(
      { data: attachment, message: 'Sample list annexed.' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to annex sample list:', error);
    return NextResponse.json(
      { error: 'The sample list could not be annexed.' },
      { status: 503 }
    );
  }
}

export async function GET(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  try {
    const attachmentId = new URL(request.url).searchParams.get('attachment');
    if (!attachmentId) {
      return NextResponse.json({ error: 'An attachment id is required.' }, { status: 400 });
    }
    const record = await queueRecord(params.id);
    const attachment = normalizeAttachments(record.attachments).find(
      (item) => item.id === attachmentId
    );
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }
    const filePath = path.join(queueDirectory(params.id), attachment.stored_name);
    const contents = attachment.blob_reference ? await readCloudDocument(attachment.blob_reference) : await fs.readFile(filePath);
    if (!contents) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    return new Response(new Uint8Array(contents), {
      headers: {
        'Content-Type': attachment.type,
        'Content-Length': String(attachment.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          attachment.name
        )}`,
      },
    });
  } catch (error) {
    console.error('Failed to download sample list:', error);
    return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  try {
    const attachmentId = new URL(request.url).searchParams.get('attachment');
    if (!attachmentId) {
      return NextResponse.json({ error: 'An attachment id is required.' }, { status: 400 });
    }
    const record = await queueRecord(params.id);
    const attachments = normalizeAttachments(record.attachments);
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }
    const remaining = attachments.filter((item) => item.id !== attachmentId);
    const supabase = getSupabaseAdminClient();
    const { error } = await (supabase.from('sample_queue_items') as any)
      .update({ attachments: remaining })
      .eq('id', params.id);
    if (error) throw error;

    if (!attachment.blob_reference) await fs.rm(path.join(queueDirectory(params.id), attachment.stored_name), {
      force: true,
    });
    return NextResponse.json({ message: 'Annexed file removed.' });
  } catch (error) {
    console.error('Failed to remove sample list:', error);
    return NextResponse.json(
      { error: 'The annexed file could not be removed.' },
      { status: 503 }
    );
  }
}
