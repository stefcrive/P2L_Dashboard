import 'server-only';
import { get, head, del } from '@vercel/blob';
import { cloudEnabled } from './database';
export async function readUploadForm(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return request.formData();
  if (!cloudEnabled()) throw new Error('Direct upload is unavailable.');
  const body = await request.json() as { fields: Array<[string, string]>; files: Array<{ field: string; pathname: string; name: string; type: string }> };
  if (!Array.isArray(body.files) || body.files.length > 50 || !Array.isArray(body.fields) || body.fields.length > 30) throw new Error('Invalid upload batch.');
  const form = new FormData();
  for (const [key, value] of body.fields) form.append(String(key), String(value));
  let total = 0;
  for (const item of body.files) {
    if (!/^uploads\/[a-f0-9-]{36}$/.test(item.pathname)) throw new Error('Invalid upload reference.');
    const info = await head(item.pathname);
    total += info.size;
    if (info.size > 32 * 1048576 || total > 256 * 1048576) throw new Error('Upload exceeds the permitted size.');
    const result = await get(item.pathname, { access: 'private' });
    if (!result || result.statusCode !== 200) throw new Error('Uploaded file is unavailable. Please upload it again.');
    const bytes = await new Response(result.stream).arrayBuffer();
    form.append(item.field, new File([bytes], item.name, { type: item.type }));
    await del(item.pathname);
  }
  return form;
}
