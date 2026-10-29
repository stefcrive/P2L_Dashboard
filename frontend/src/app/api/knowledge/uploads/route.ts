import { readUploadForm } from '@/lib/cloud/upload-form';
import { persistKnowledgeFile } from '@/lib/cloud/knowledge-files';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getKnowledgeConfig } from '@/lib/knowledge/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.xls',
  '.xlsx',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 256 * 1_048_576;
const MAX_FILE_BYTES = 32 * 1_048_576;

function safeFileName(value: string) {
  const base = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return (
    base.replace(/^\.+/, '').slice(0, 180) || `document-${randomUUID()}.txt`
  );
}

export async function POST(request: Request) {
  try {
    const formData = await readUploadForm(request);
    const files = formData
      .getAll('files')
      .filter(
        (value): value is File => value instanceof File && value.size > 0
      );
    if (!files.length) {
      return NextResponse.json(
        { error: 'Select at least one non-empty file.' },
        { status: 400 }
      );
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `A batch can contain at most ${MAX_FILES} files.` },
        { status: 400 }
      );
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    const oversized = files.filter((file) => file.size > MAX_FILE_BYTES);
    if (oversized.length) {
      return NextResponse.json(
        {
          error: `${oversized
            .map((file) => file.name)
            .join(', ')} exceeds the 32 MB per-file limit.`,
        },
        { status: 400 }
      );
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: 'The selected batch exceeds the 256 MB upload limit.' },
        { status: 400 }
      );
    }

    const unsupported = files.filter(
      (file) => !SUPPORTED_EXTENSIONS.has(path.extname(file.name).toLowerCase())
    );
    if (unsupported.length) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${unsupported
            .map((file) => file.name)
            .join(', ')}. Use TXT, Markdown, CSV, TSV, XLS, XLSX, PDF, PNG, JPEG, WEBP, or GIF.`,
        },
        { status: 400 }
      );
    }

    const config = getKnowledgeConfig();
    const batchDirectory = path.join(
      config.repositoryRoot,
      '.local-data',
      'knowledge-uploads',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    );
    await fs.mkdir(batchDirectory, { recursive: true });

    const stored: Array<{ name: string; bytes: number }> = [];
    for (const file of files) {
      let fileName = safeFileName(file.name);
      let destination = path.join(batchDirectory, fileName);
      let suffix = 2;
      while (
        await fs
          .access(destination)
          .then(() => true)
          .catch(() => false)
      ) {
        const extension = path.extname(fileName);
        fileName = `${path.basename(fileName, extension)}-${suffix}${extension}`;
        destination = path.join(batchDirectory, fileName);
        suffix += 1;
      }
      await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()));
      await persistKnowledgeFile(destination);
      stored.push({ name: fileName, bytes: file.size });
    }

    return NextResponse.json(
      {
        sourcePath: batchDirectory,
        totalBytes,
        files: stored,
      },
      { status: 201 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to upload documents.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
