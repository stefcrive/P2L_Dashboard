'use client';
import { upload } from '@vercel/blob/client';
export async function postUploadForm(url: string, form: FormData, signal?: AbortSignal) {
  if (process.env.NEXT_PUBLIC_HOSTED !== '1') return fetch(url, { method: 'POST', body: form, signal });
  const fields: Array<[string, string]> = [];
  const files: Array<{ field: string; pathname: string; name: string; type: string }> = [];
  for (const [field, value] of Array.from(form.entries())) {
    if (typeof value === 'string') fields.push([field, value]);
    else {
      if (value.size > 32 * 1048576) throw new Error('Files must be no larger than 32 MB.');
      const result = await upload(`uploads/${crypto.randomUUID()}`, value, { access: 'private', handleUploadUrl: '/api/uploads/token', multipart: value.size > 4 * 1048576 });
      files.push({ field, pathname: result.pathname, name: value.name, type: value.type });
    }
  }
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-P2L-Direct-Upload': '1' }, body: JSON.stringify({ fields, files }), signal });
}
