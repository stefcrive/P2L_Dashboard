import { NextResponse } from 'next/server';

import { getLocalAppDatabase } from '@/lib/local-db/db';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  try {
    const source = getApplicationDatabaseSource();
    if (source === 'local') {
      const database = await getLocalAppDatabase();
      await database.query('SELECT 1');
    } else {
      const { error } = await getSupabaseAdminClient()
        .from('clients')
        .select('id', { head: true, count: 'exact' });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json(
      { ready: true, source },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ready: false,
        error:
          error instanceof Error ? error.message : 'Database unavailable.',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
