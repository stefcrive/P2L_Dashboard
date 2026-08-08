import crypto from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import {
  exchangeGmailAuthorizationCode,
  getGmailRedirectUri,
  saveGmailConnection,
} from '@/lib/gmail/client';

export const dynamic = 'force-dynamic';

function sameValue(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function settingsRedirect(request: NextRequest, state: string) {
  return NextResponse.redirect(
    new URL(`/settings/agent-email?gmail=${encodeURIComponent(state)}`, request.url)
  );
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get('error');
  if (error) return settingsRedirect(request, 'denied');

  const code = request.nextUrl.searchParams.get('code') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  const savedState = request.cookies.get('p2l_gmail_oauth_state')?.value ?? '';
  const codeVerifier = request.cookies.get('p2l_gmail_code_verifier')?.value ?? '';
  if (!code || !state || !savedState || !codeVerifier || !sameValue(state, savedState)) {
    return settingsRedirect(request, 'invalid-state');
  }

  try {
    const tokens = await exchangeGmailAuthorizationCode({
      code,
      codeVerifier,
      redirectUri: getGmailRedirectUri(request.url),
    });
    await saveGmailConnection(tokens);
    const response = settingsRedirect(request, 'connected');
    response.cookies.delete('p2l_gmail_oauth_state');
    response.cookies.delete('p2l_gmail_code_verifier');
    return response;
  } catch {
    const response = settingsRedirect(request, 'error');
    response.cookies.delete('p2l_gmail_oauth_state');
    response.cookies.delete('p2l_gmail_code_verifier');
    return response;
  }
}
