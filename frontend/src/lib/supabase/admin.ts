import 'server-only';

import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

import { getWorkspaceEnvironmentValue } from '@/lib/knowledge/config';
import { getLocalSupabaseClient } from '@/lib/local-db/supabase-adapter';

// Route code intentionally uses the Supabase query-builder surface. The embedded
// adapter implements that same runtime contract without sharing Supabase's large
// generated generic type graph.
let cachedClient: any = null;
let envBootstrapped = false;

const silentLogger = {
  info: () => undefined,
  error: () => undefined,
};

function ensureServerEnvLoaded() {
  if (envBootstrapped) {
    return;
  }

  const candidateRoots = Array.from(
    new Set([
      process.cwd(),
      path.resolve(process.cwd(), '..'),
      path.resolve(process.cwd(), 'frontend'),
    ])
  );

  for (const rootPath of candidateRoots) {
    try {
      loadEnvConfig(
        rootPath,
        process.env.NODE_ENV !== 'production',
        silentLogger
      );
    } catch {
      // Ignore unreadable candidates and keep trying fallback roots.
    }
  }

  envBootstrapped = true;
}

function readFirstEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function getSupabaseAdminClient(): any {
  if (cachedClient) {
    return cachedClient;
  }

  const databaseMode =
    getWorkspaceEnvironmentValue('APP_DATABASE_MODE')?.toLowerCase() ?? 'local';
  if (databaseMode !== 'supabase') {
    cachedClient = getLocalSupabaseClient();
    return cachedClient;
  }

  ensureServerEnvLoaded();

  const supabaseUrl = readFirstEnvValue(
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL'
  );
  const serviceRoleKey = readFirstEnvValue(
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY'
  );
  const anonKey = readFirstEnvValue(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
    'SUPABASE_ANON_KEY'
  );
  const supabaseKey = serviceRoleKey || anonKey;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase mode is selected, but its URL and API key are not configured.'
    );
  }

  const localOnly = readFirstEnvValue('SUPABASE_LOCAL_ONLY') !== 'false';
  const hostname = new URL(supabaseUrl).hostname;
  const isLocalHost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (localOnly && !isLocalHost) {
    throw new Error(
      'Remote Supabase is disabled for this local-first application. Start with `npm run dev:local`, or set SUPABASE_LOCAL_ONLY=false explicitly.'
    );
  }

  cachedClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

export function getApplicationDatabaseSource() {
  return getWorkspaceEnvironmentValue('APP_DATABASE_MODE')?.toLowerCase() ===
    'supabase'
    ? ('supabase' as const)
    : ('local' as const);
}
