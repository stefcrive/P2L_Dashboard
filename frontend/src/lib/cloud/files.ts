import 'server-only';
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';

export async function storeCloudDocument(bytes: Uint8Array) {
  const digest=createHash('sha256').update(bytes).digest('hex');
  await put(`documents/${digest}`,Buffer.from(bytes),{access:'private',addRandomSuffix:false,allowOverwrite:true});
  return `blob://${digest}`;
}
export async function readCloudDocument(reference: string) {
  const digest=reference.replace(/^blob:\/\//,'');
  if(!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid document reference.');
  const result=await get(`documents/${digest}`,{access:'private'});
  if(!result || result.statusCode!==200) return null;
  const bytes=new Uint8Array(await new Response(result.stream).arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==digest) throw new Error('The stored document failed its integrity check.');
  return bytes;
}
