import { NextResponse } from 'next/server';

import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';
import {
  isResourceName,
  resourceConfigs,
  sanitizeResourcePayload,
} from '@/lib/operations/resources';

export const dynamic = 'force-dynamic';

const maintenanceProjectionWritable = new Set([
  'status',
  'occurred_at',
  'next_due_at',
]);

type RouteContext = {
  params: Promise<{
    resource: string;
  }>;
};

function invalidResource() {
  return NextResponse.json(
    { error: 'Unknown laboratory resource.' },
    { status: 404 }
  );
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error:
        'The embedded local database is unavailable. Restart the application and check `.local-data/app-postgres`.',
    },
    { status: 503 }
  );
}

export async function GET(_request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  if (!isResourceName(params.resource)) return invalidResource();

  try {
    const config = resourceConfigs[params.resource];
    const supabase = getSupabaseAdminClient();
    const table = supabase.from(config.table) as any;
    const { data, error } = await table
      .select(config.select)
      .order(config.orderColumn, { ascending: config.ascending ?? false })
      .limit(config.limit ?? 250);

    if (error) throw error;
    return NextResponse.json({
      data: data ?? [],
      source: getApplicationDatabaseSource(),
    });
  } catch (error) {
    console.error(
      `Failed to read operations resource ${params.resource}:`,
      error
    );
    return unavailableResponse();
  }
}

export async function POST(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  if (!isResourceName(params.resource)) return invalidResource();
  const config = resourceConfigs[params.resource];
  if (config.readOnly) {
    return NextResponse.json(
      { error: 'This resource is read-only here.' },
      { status: 405 }
    );
  }

  try {
    const payload = sanitizeResourcePayload(
      params.resource,
      await request.json()
    );
    const supabase = getSupabaseAdminClient();
    const table = supabase.from(config.table) as any;
    const { data, error } = await table
      .insert(payload)
      .select(config.select)
      .single();

    if (error) throw error;
    return NextResponse.json(
      { data, message: 'Record saved.' },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Complete the required fields')
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return unavailableResponse();
  }
}

export async function PATCH(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  if (!isResourceName(params.resource)) return invalidResource();
  const config = resourceConfigs[params.resource];
  if (config.readOnly) {
    return NextResponse.json(
      { error: 'This resource is read-only here.' },
      { status: 405 }
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { error: 'A record id is required.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const requestPayload = (await request.json()) as Record<string, unknown>;
    if (params.resource === 'lab-book') {
      const { data: existing, error: existingError } = await (
        supabase.from('lab_book_entries') as any
      )
        .select('source_key')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.source_key?.startsWith('maintenance:')) {
        for (const key of Object.keys(requestPayload)) {
          if (!maintenanceProjectionWritable.has(key)) {
            return NextResponse.json(
              {
                error:
                  'This maintenance alert is owned by its equipment schedule. Manage identity and recurrence from Equipment.',
              },
              { status: 409 }
            );
          }
        }
      }
    }
    const payload = sanitizeResourcePayload(
      params.resource,
      requestPayload,
      false
    );
    const table = supabase.from(config.table) as any;
    const { data, error } = await table
      .update(payload)
      .eq('id', id)
      .select(config.select)
      .single();

    if (error) throw error;
    return NextResponse.json({ data, message: 'Changes saved.' });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Complete the required fields')
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return unavailableResponse();
  }
}

export async function DELETE(request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  if (!isResourceName(params.resource)) return invalidResource();
  const config = resourceConfigs[params.resource];
  if (config.readOnly) {
    return NextResponse.json(
      { error: 'This resource is read-only here.' },
      { status: 405 }
    );
  }

  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { error: 'A record id is required.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    if (params.resource === 'lab-book') {
      const { data: existing, error: existingError } = await (
        supabase.from('lab_book_entries') as any
      )
        .select('source_key')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.source_key?.startsWith('maintenance:')) {
        return NextResponse.json(
          {
            error:
              'This maintenance alert is owned by its equipment schedule. Clear or change the schedule from Equipment.',
          },
          { status: 409 }
        );
      }
    }
    const table = supabase.from(config.table) as any;
    const { error } = await table.delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ message: 'Record deleted.' });
  } catch (error) {
    console.error(
      `Failed to delete operations resource ${params.resource}:`,
      error
    );
    return unavailableResponse();
  }
}
