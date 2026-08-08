import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  GMAIL_SCOPE,
  getGmailOAuthConfiguration,
  getGmailRedirectUri,
} from '@/lib/gmail/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const configuration = getGmailOAuthConfiguration();
  if (!configuration.configured || !configuration.clientId) {
    return NextResponse.redirect(
      new URL('/settings/agent-email?gmail=not-configured', request.url)
    );
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const redirectUri = getGmailRedirectUri(request.url);
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  const secure = new URL(request.url).protocol === 'https:';
  response.cookies.set('p2l_gmail_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 600,
    path: '/',
  });
  response.cookies.set('p2l_gmail_code_verifier', codeVerifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 600,
    path: '/',
  });
  return response;
}
