import { readUploadForm } from '@/lib/cloud/upload-form';
import { NextResponse } from 'next/server';

import {
  MAX_CLIENT_DOCUMENT_BYTES,
  normalizeDocumentCategory,
  storeClientDocument,
} from '@/lib/client-manager/documents';
import { importResultFile, type ResultClient } from '@/lib/results/importer';
import { parseResultFileName, parseResultWorkbook } from '@/lib/results/parser';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await readUploadForm(request);
    const clientId = String(formData.get('clientId') ?? '').trim();
    const file = formData.get('file');
    const category = normalizeDocumentCategory(formData.get('category'));
    const parsedYear = Number.parseInt(String(formData.get('year') ?? ''), 10);

    if (!clientId || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: 'Choose a client and a non-empty document.' },
        { status: 400 }
      );
    }
    if (file.size > MAX_CLIENT_DOCUMENT_BYTES) {
      return NextResponse.json(
        { error: 'Documents are limited to 25 MB per upload.' },
        { status: 400 }
      );
    }

    if (category === 'analysis') {
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        return NextResponse.json(
          { error: 'Result uploads must be .xlsx or .xls files.' },
          { status: 400 }
        );
      }
      const database = getSupabaseAdminClient();
      const { data: client, error: clientError } = await database
        .from('clients')
        .select('id, name')
        .eq('id', clientId)
        .maybeSingle();
      if (clientError) throw new Error(clientError.message);
      if (!client) {
        return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileName = file.name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim();
      const metadata = parseResultFileName(fileName);
      const parsed = parseResultWorkbook(bytes, fileName);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const relativePath = `Results/uploads/${timestamp}-${fileName}`;
      const imported = await importResultFile({
        client: client as ResultClient,
        bytes,
        metadata: {
          ...metadata,
          resultYear: Number.isInteger(parsedYear)
            ? parsedYear
            : metadata.resultYear,
        },
        parsed,
        relativePath,
        absolutePath: `database://${relativePath}`,
        storageOrigin: 'upload',
      });

      return NextResponse.json(
        {
          message: `${fileName} imported for ${String(client.name)}.`,
          ...imported,
        },
        { status: 201 }
      );
    }

    const data = await storeClientDocument({
      clientId,
      file,
      category,
      year: Number.isInteger(parsedYear) ? parsedYear : null,
    });

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
