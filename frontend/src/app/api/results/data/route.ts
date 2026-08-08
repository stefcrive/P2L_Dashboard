import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function cleanSearchValue(value: string | null) {
  return (value ?? '').replace(/[,%]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureInitialSync(request: Request) {
  const database = getSupabaseAdminClient();
  const { count, error } = await database
    .from('client_result_files')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return null;
  const response = await fetch(new URL('/api/results/sync', request.url), {
    method: 'POST',
    cache: 'no-store',
  });
  if (response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return payload?.error ?? `Initial result sync failed (${response.status}).`;
}

export async function GET(request: Request) {
  try {
    const syncWarning = await ensureInitialSync(request);
    const database = getSupabaseAdminClient();
    const params = new URL(request.url).searchParams;
    const identifier1 = params
      .getAll('identifier1')
      .map((value) => cleanSearchValue(value))
      .filter(Boolean);
    const identifier2 = params
      .getAll('identifier2')
      .map((value) => cleanSearchValue(value))
      .filter(Boolean);
    const species = params
      .getAll('species')
      .map((value) => cleanSearchValue(value))
      .filter(Boolean);
    const clientId = params
      .getAll('clientId')
      .map((value) => cleanSearchValue(value))
      .filter(Boolean);
    const resultFileId = params
      .getAll('resultFileId')
      .map((value) => cleanSearchValue(value))
      .filter(Boolean);

    const { data: resultFiles, error: filesError } = await database
      .from('client_result_files')
      .select(
        'id, client_id, source_document_id, analysis_series, result_date, row_count, identifier_1_count, species_count, status, import_error, created_at, updated_at, client:clients(id, name), source_document:client_documents(id, file_name, relative_path, file_size_bytes)'
      )
      .order('result_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(300);
    if (filesError) throw new Error(filesError.message);

    let query = database
      .from('result_measurements')
      .select(
        'id, result_file_id, client_id, identifier_1, identifier_2, identifier_2_order, species, d13c_value, d13c_uncertainty, d18o_value, d18o_uncertainty, corrected_d13c, corrected_d18o, method, observation, source_sheet, source_row, client:clients(id, name), result_file:client_result_files(id, analysis_series, result_date, source_document_id)',
        { count: 'exact' }
      );
    if (identifier1.length) {
      query = query.in('identifier_1', identifier1);
    }
    if (identifier2.length) {
      query = query.in('identifier_2', identifier2);
    }
    if (species.length) {
      query = query.in('species', species);
    }
    if (clientId.length) query = query.in('client_id', clientId);
    if (resultFileId.length) query = query.in('result_file_id', resultFileId);
    const {
      data: measurements,
      error: measurementsError,
      count: measurementCount,
    } = await query
      .order('identifier_2_order', { ascending: true, nullsFirst: false })
      .order('identifier_2', { ascending: true })
      .order('source_row', { ascending: true })
      .limit(1000);
    if (measurementsError) throw new Error(measurementsError.message);

    return NextResponse.json({
      resultFiles: resultFiles ?? [],
      measurements: measurements ?? [],
      measurementCount: measurementCount ?? 0,
      truncated: (measurementCount ?? 0) > (measurements?.length ?? 0),
      warnings: syncWarning ? [syncWarning] : [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load the result register.',
      },
      { status: 500 }
    );
  }
}
