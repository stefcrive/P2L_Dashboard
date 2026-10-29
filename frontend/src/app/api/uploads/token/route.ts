import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { cloudEnabled } from '@/lib/cloud/database';
export async function POST(request: Request) {
  if (!cloudEnabled()) return NextResponse.json({ error: 'Direct uploads are available in the hosted workspace.' }, { status: 400 });
  try {
    const result = await handleUpload({ request, body: await request.json() as HandleUploadBody, onBeforeGenerateToken: async pathname => {
      if (!/^uploads\/[a-f0-9-]{36}$/.test(pathname)) throw new Error('Invalid upload path.');
      return { maximumSizeInBytes: 32 * 1048576, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60 * 1000 };
    } });
    return NextResponse.json(result);
  } catch { return NextResponse.json({ error: 'Unable to authorize upload.' }, { status: 400 }); }
}
