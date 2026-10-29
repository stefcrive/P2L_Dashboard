import { readUploadForm } from '@/lib/cloud/upload-form';
import { NextResponse } from 'next/server';

import {
  createResultClient,
  importResultFile,
  type ResultClient,
} from '@/lib/results/importer';
import {
  matchExistingResultClient,
  parseResultFileName,
  parseResultWorkbook,
} from '@/lib/results/parser';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 120;

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'results.xlsx';
}

export async function POST(request: Request) {
  try {
    const formData = await readUploadForm(request);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: 'Choose a non-empty Excel result file.' },
        { status: 400 }
      );
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      return NextResponse.json(
        { error: 'Result uploads must be .xlsx or .xls files.' },
        { status: 400 }
      );
    }
    if (file.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Result files are limited to 30 MB per upload.' },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = safeFileName(file.name);
    const metadata = parseResultFileName(fileName);
    const database = getSupabaseAdminClient();
    const { data: clientRows, error: clientsError } = await database
      .from('clients')
      .select('id, name')
      .order('name');
    if (clientsError) throw new Error(clientsError.message);
    let client = matchExistingResultClient(
      metadata.clientCandidate,
      (clientRows ?? []) as ResultClient[]
    );
    if (!client) {
      client = await createResultClient(metadata.clientCandidate);
    }

    const parsed = parseResultWorkbook(bytes, fileName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const relativePath = `Results/uploads/${timestamp}-${fileName}`;
    const imported = await importResultFile({
      client,
      bytes,
      metadata,
      parsed,
      relativePath,
      absolutePath: `database://${relativePath}`,
      storageOrigin: 'upload',
    });

    return NextResponse.json(
      {
        message: `${fileName} imported for ${client.name}.`,
        client,
        metadata,
        ...imported,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to import the result file.',
      },
      { status: 500 }
    );
  }
}
