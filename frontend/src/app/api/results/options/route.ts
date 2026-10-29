import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const database = getSupabaseAdminClient();
    const pageSize = 10_000;
    const rows: unknown[] = [];
    let offset = 0;
    let count = 0;

    // The filter controls need the complete option set. A single 50,000-row
    // request silently omitted clients whose measurements sorted after that
    // cutoff, so read the result set in deterministic pages instead.
    while (true) {
      const { data, error, count: pageCount } = await database
        .from('result_measurements')
        .select(
          'result_file_id, client_id, identifier_1, identifier_2, species, client:clients(id, name)',
          offset === 0 ? { count: 'exact' } : undefined
        )
        .order('identifier_1', { ascending: true })
        .order('identifier_2_order', { ascending: true, nullsFirst: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(error.message);

      const page = data ?? [];
      rows.push(...page);
      if (offset === 0) count = pageCount ?? page.length;
      if (page.length < pageSize) break;
      offset += page.length;
    }

    return NextResponse.json({
      rows,
      count,
      truncated: count > rows.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load result search options.',
      },
      { status: 500 }
    );
  }
}
