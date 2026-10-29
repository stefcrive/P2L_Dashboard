import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  if (!process.env.VERCEL && process.env.P2L_REQUIRE_AUTH !== '1') return NextResponse.next();
  const path=request.nextUrl.pathname;
  if(path==='/login' || path==='/logo_sem_texto.png' || path==='/favicon.png' || path==='/brand/p2l-logo.png' || path==='/brand/evostudio-logo.svg' || path.startsWith('/api/auth/')) return NextResponse.next();
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
    const origin=request.headers.get('origin');
    if(request.headers.get('sec-fetch-site')==='cross-site' || (origin && new URL(origin).host!==request.nextUrl.host)) return NextResponse.json({error:'Request origin is not allowed.'},{status:403});
  }
  const cookie=request.cookies.get('irms_session');
  let signedIn=false;
  if(cookie && process.env.IRMS_AUTH_URL) {
    try {
      const response=await fetch(`${process.env.IRMS_AUTH_URL}/auth/session`,{headers:{cookie:`irms_session=${cookie.value}`},cache:'no-store'});
      signedIn=response.ok && Boolean((await response.json()).user);
    } catch { return NextResponse.json({error:'The sign-in service could not be reached. Try again.'},{status:503}); }
  }
  if(signedIn) return NextResponse.next();
  if(path.startsWith('/api/')) return NextResponse.json({error:'Sign in to continue.'},{status:401});
  const url=new URL('/login',request.url); url.searchParams.set('next',path);
  return NextResponse.redirect(url);
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|icon.png).*)']};
