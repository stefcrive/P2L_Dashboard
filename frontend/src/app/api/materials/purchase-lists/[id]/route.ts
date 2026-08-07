import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface PurchaseListUpdatePayload {
  name?: string;
  providerName?: string;
  status?: string;
}

function getReadableError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error';
  return (error as { message?: string }).message ?? 'Unknown error';
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json().catch(() => null)) as
      | PurchaseListUpdatePayload
      | null;
    const updates: Record<string, string | null> = {};

    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json(
          { error: 'A purchase request name is required.' },
          { status: 400 }
        );
      }
      updates.name = name;
    }
    if (typeof body?.providerName === 'string') {
      updates.provider_name = body.providerName.trim() || null;
    }
    if (typeof body?.status === 'string' && body.status.trim()) {
      updates.status = body.status.trim();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'At least one purchase request field is required.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await (supabase.from('material_purchase_lists') as any)
      .update(updates)
      .eq('id', params.id)
      .select('id, name')
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Unable to update purchase request: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Purchase request "${data.name}" updated.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected purchase request error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getSupabaseAdminClient();
    const { error } = await (supabase.from('material_purchase_lists') as any)
      .delete()
      .eq('id', params.id);

    if (error) {
      return NextResponse.json(
        { error: `Unable to delete purchase request: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Purchase request deleted.' });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected purchase request error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}
