import 'server-only';

import crypto from 'node:crypto';

import { getWorkspaceEnvironmentValue } from '@/lib/knowledge/config';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

const GMAIL_API_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

type GmailConnectionRow = {
  id: string;
  email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string;
  scope: string;
  connected_at: string;
  updated_at: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GmailHeader = { name?: string; value?: string };

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart & { headers?: GmailHeader[] };
};

export type GmailConnectionStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  capabilities: string[];
  missingConfiguration: string[];
};

function requiredEnvironment(name: string) {
  const value = getWorkspaceEnvironmentValue(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function getGmailOAuthConfiguration() {
  const clientId = getWorkspaceEnvironmentValue('GMAIL_CLIENT_ID');
  const clientSecret = getWorkspaceEnvironmentValue('GMAIL_CLIENT_SECRET');
  const encryptionSecret =
    getWorkspaceEnvironmentValue('GMAIL_TOKEN_ENCRYPTION_KEY') ??
    getWorkspaceEnvironmentValue('SECRET_KEY');

  const missingConfiguration = [
    !clientId && 'GMAIL_CLIENT_ID',
    !clientSecret && 'GMAIL_CLIENT_SECRET',
    !encryptionSecret && 'GMAIL_TOKEN_ENCRYPTION_KEY',
  ].filter((value): value is string => Boolean(value));

  return {
    clientId,
    clientSecret,
    encryptionSecret,
    missingConfiguration,
    configured: missingConfiguration.length === 0,
  };
}

export function getGmailRedirectUri(requestUrl: string) {
  return (
    getWorkspaceEnvironmentValue('GMAIL_REDIRECT_URI') ??
    new URL('/api/integrations/gmail/callback', requestUrl).toString()
  );
}

function encryptionKey() {
  const secret =
    getWorkspaceEnvironmentValue('GMAIL_TOKEN_ENCRYPTION_KEY') ??
    requiredEnvironment('SECRET_KEY');
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptToken(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('The saved Gmail authorization is invalid. Reconnect the account.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function readConnection(): Promise<GmailConnectionRow | null> {
  const database = getSupabaseAdminClient();
  const { data, error } = await database
    .from('gmail_connections')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  if (error) throw error;
  return (data as GmailConnectionRow | null) ?? null;
}

export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const configuration = getGmailOAuthConfiguration();
  let connection: GmailConnectionRow | null = null;
  try {
    connection = await readConnection();
  } catch {
    // A missing migration should still leave the setup guidance usable.
  }

  return {
    configured: configuration.configured,
    connected: Boolean(connection),
    email: connection?.email ?? null,
    connectedAt: connection?.connected_at ?? null,
    updatedAt: connection?.updated_at ?? null,
    capabilities: ['Search email', 'Read messages', 'Create drafts', 'Send email'],
    missingConfiguration: configuration.missingConfiguration,
  };
}

async function requestTokens(parameters: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parameters,
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ?? payload.error ?? 'Google did not issue an access token.'
    );
  }
  return payload;
}

export async function exchangeGmailAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const configuration = getGmailOAuthConfiguration();
  if (!configuration.clientId || !configuration.clientSecret) {
    throw new Error('Google OAuth credentials are not configured.');
  }
  return requestTokens(
    new URLSearchParams({
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    })
  );
}

async function refreshAccessToken(connection: GmailConnectionRow) {
  const configuration = getGmailOAuthConfiguration();
  if (!configuration.clientId || !configuration.clientSecret) {
    throw new Error('Google OAuth credentials are not configured.');
  }
  const refreshToken = decryptToken(connection.refresh_token_encrypted);
  const tokens = await requestTokens(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: 'refresh_token',
    })
  );
  const accessToken = tokens.access_token!;
  const expiresAt = new Date(
    Date.now() + Math.max(tokens.expires_in ?? 3600, 60) * 1000
  ).toISOString();
  const database = getSupabaseAdminClient();
  const { error } = await database
    .from('gmail_connections')
    .update({
      access_token_encrypted: encryptToken(accessToken),
      expires_at: expiresAt,
      scope: tokens.scope ?? connection.scope,
    })
    .eq('id', 'default');
  if (error) throw error;
  return accessToken;
}

async function getAccessToken(forceRefresh = false) {
  const connection = await readConnection();
  if (!connection) {
    throw new Error('No Gmail account is connected. Connect one in Settings > Agent email.');
  }
  const expiresSoon = new Date(connection.expires_at).getTime() <= Date.now() + 60_000;
  if (forceRefresh || expiresSoon) return refreshAccessToken(connection);
  return decryptToken(connection.access_token_encrypted);
}

async function gmailFetch<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${GMAIL_API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (response.status === 401 && retry) {
    await getAccessToken(true);
    return gmailFetch<T>(path, init, false);
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gmail request failed (${response.status}).`);
  }
  return payload;
}

export async function saveGmailConnection(tokens: TokenResponse) {
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google did not return offline access. Reconnect and grant consent again.');
  }
  const profileResponse = await fetch(`${GMAIL_API_ROOT}/profile`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    emailAddress?: string;
    error?: { message?: string };
  };
  if (!profileResponse.ok || !profile.emailAddress) {
    throw new Error(profile.error?.message ?? 'The Gmail account profile could not be read.');
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + Math.max(tokens.expires_in ?? 3600, 60) * 1000
  ).toISOString();
  const database = getSupabaseAdminClient();
  const { error } = await database.from('gmail_connections').upsert(
    {
      id: 'default',
      email: profile.emailAddress,
      access_token_encrypted: encryptToken(tokens.access_token),
      refresh_token_encrypted: encryptToken(tokens.refresh_token),
      expires_at: expiresAt,
      scope: tokens.scope ?? GMAIL_SCOPE,
      connected_at: now,
    },
    { onConflict: 'id' }
  );
  if (error) throw error;
  return profile.emailAddress;
}

export async function disconnectGmail() {
  const connection = await readConnection();
  if (connection) {
    try {
      const refreshToken = decryptToken(connection.refresh_token_encrypted);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } catch {
      // Local removal still prevents future access when Google revocation is unavailable.
    }
  }
  const database = getSupabaseAdminClient();
  const { error } = await database.from('gmail_connections').delete().eq('id', 'default');
  if (error) throw error;
}

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
    ?.value;
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMessageContent(part: GmailMessagePart | undefined) {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: Array<{
    fileName: string;
    mimeType: string;
    size: number;
    attachmentId: string | null;
  }> = [];

  const visit = (current: GmailMessagePart | undefined) => {
    if (!current) return;
    const data = current.body?.data;
    if (data && current.mimeType === 'text/plain') plain.push(decodeBase64Url(data));
    if (data && current.mimeType === 'text/html') html.push(stripHtml(decodeBase64Url(data)));
    if (current.filename) {
      attachments.push({
        fileName: current.filename,
        mimeType: current.mimeType ?? 'application/octet-stream',
        size: current.body?.size ?? 0,
        attachmentId: current.body?.attachmentId ?? null,
      });
    }
    current.parts?.forEach(visit);
  };
  visit(part);
  return {
    body: (plain.join('\n\n').trim() || html.join('\n\n').trim()).slice(0, 40_000),
    attachments,
  };
}

function summarizeMessage(message: GmailMessage) {
  const headers = message.payload?.headers;
  return {
    id: message.id,
    threadId: message.threadId ?? null,
    from: headerValue(headers, 'From') ?? null,
    to: headerValue(headers, 'To') ?? null,
    subject: headerValue(headers, 'Subject') ?? '(no subject)',
    date: headerValue(headers, 'Date') ?? null,
    snippet: message.snippet ?? '',
    labels: message.labelIds ?? [],
  };
}

export async function searchGmail(input: { query?: string; maxResults?: number }) {
  const maxResults = Math.min(Math.max(Math.round(input.maxResults ?? 10), 1), 20);
  const parameters = new URLSearchParams({ maxResults: String(maxResults) });
  if (input.query?.trim()) parameters.set('q', input.query.trim().slice(0, 500));
  const listing = await gmailFetch<{
    messages?: Array<{ id: string }>;
    resultSizeEstimate?: number;
  }>(`/messages?${parameters.toString()}`);
  const messages = await Promise.all(
    (listing.messages ?? []).map(({ id }) =>
      gmailFetch<GmailMessage>(
        `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
      )
    )
  );
  return {
    query: input.query?.trim() ?? '',
    resultSizeEstimate: listing.resultSizeEstimate ?? messages.length,
    messages: messages.map(summarizeMessage),
  };
}

export async function readGmailMessage(messageId: string) {
  const id = messageId.trim();
  if (!id) throw new Error('A Gmail message id is required.');
  const message = await gmailFetch<GmailMessage>(
    `/messages/${encodeURIComponent(id)}?format=full`
  );
  return {
    ...summarizeMessage(message),
    ...extractMessageContent(message.payload),
  };
}

function cleanHeader(value: string, label: string) {
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function encodeSubject(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function createRawMessage(input: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}) {
  const to = input.to.map((value) => cleanHeader(value, 'Recipient'));
  if (!to.length) throw new Error('At least one recipient is required.');
  const cc = (input.cc ?? []).map((value) => cleanHeader(value, 'CC recipient'));
  const subject = cleanHeader(input.subject, 'Subject');
  if (!input.body.trim()) throw new Error('Email body is required.');
  const headers = [
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(input.body, 'utf8').toString('base64')}`;
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export async function createGmailDraft(input: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}) {
  const result = await gmailFetch<{
    id: string;
    message?: { id?: string; threadId?: string };
  }>('/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: createRawMessage(input) } }),
  });
  return {
    success: true,
    draftId: result.id,
    messageId: result.message?.id ?? null,
    threadId: result.message?.threadId ?? null,
    recipients: input.to,
    subject: input.subject,
  };
}

export async function sendGmailMessage(input: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}) {
  const result = await gmailFetch<{ id: string; threadId?: string; labelIds?: string[] }>(
    '/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw: createRawMessage(input) }),
    }
  );
  return {
    success: true,
    messageId: result.id,
    threadId: result.threadId ?? null,
    recipients: input.to,
    subject: input.subject,
  };
}
