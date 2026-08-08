import { NextResponse } from 'next/server';

import {
  MAX_CLIENT_DOCUMENT_BYTES,
  normalizeDocumentCategory,
  storeClientDocument,
} from '@/lib/client-manager/documents';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
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
