import { NextRequest, NextResponse } from 'next/server';

async function proxy(request: NextRequest, action: string) {
  if(!['session','login','logout'].includes(action)) return NextResponse.json({error:'Not found'},{status:404});
  if(!process.env.IRMS_AUTH_URL) return NextResponse.json({error:'Sign-in service is not configured.'},{status:503});
  if(request.method!=='GET') {
    const origin=request.headers.get('origin');
    if(request.headers.get('sec-fetch-site')==='cross-site' || (origin && new URL(origin).host!==request.nextUrl.host)) return NextResponse.json({error:'Request origin is not allowed.'},{status:403});
  }
  try {
    const response=await fetch(`${process.env.IRMS_AUTH_URL}/auth/${action}`,{
      method:request.method, headers:{'Content-Type':'application/json',cookie:request.headers.get('cookie')??'','x-forwarded-host':new URL(process.env.IRMS_AUTH_URL).host, origin:new URL(process.env.IRMS_AUTH_URL).origin},
      body:request.method==='POST'?await request.text():undefined,cache:'no-store',
    });
    // Upstream outages can return plain text or an HTML error page. Never label
    // those bodies as JSON or expose backend diagnostics to the login page.
    const payload: unknown = await response.json().catch(() => null);
    if (response.status >= 500 || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({error:'The sign-in service is temporarily unavailable. Try again.'},{status:503,headers:{'Cache-Control':'no-store'}});
    }
    const result=NextResponse.json(payload,{status:response.status,headers:{'Cache-Control':'no-store'}});
    const cookie=response.headers.get('set-cookie'); if(cookie) result.headers.set('set-cookie',cookie);
    return result;
  } catch { return NextResponse.json({error:'The sign-in service could not be reached. Try again.'},{status:503,headers:{'Cache-Control':'no-store'}}); }
}
export async function GET(request:NextRequest,{params:paramsPromise}:{params: Promise<{action:string}>}) {
  const params = await paramsPromise; return proxy(request,params.action); }
export async function POST(request:NextRequest,{params:paramsPromise}:{params: Promise<{action:string}>}) {
  const params = await paramsPromise; return proxy(request,params.action); }
