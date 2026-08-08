import { NextResponse } from 'next/server';

import { MATERIAL_TYPES, type MaterialInventoryRow } from '@/lib/materials/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

const AVAILABILITY = [
  'available',
  'low_stock',
  'out_of_stock',
  'on_order',
  'unavailable',
] as const;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const name = textOrNull(body.name);
  const materialType = textOrNull(body.materialType);
  const availability = textOrNull(body.availabilityStatus);
  const currency = (textOrNull(body.currency) ?? 'BRL').toUpperCase();
  if (!name) {
    return NextResponse.json({ error: 'Material name is required.' }, { status: 400 });
  }
  if (!materialType || !MATERIAL_TYPES.includes(materialType as never)) {
    return NextResponse.json({ error: 'Invalid material category.' }, { status: 400 });
  }
  if (!availability || !AVAILABILITY.includes(availability as never)) {
    return NextResponse.json({ error: 'Invalid availability status.' }, { status: 400 });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return NextResponse.json({ error: 'Currency must use a three-letter code.' }, { status: 400 });
  }

  const database = getSupabaseAdminClient();
  const { data: previous, error: readError } = await database
    .from('materials_inventory')
    .select('id, current_stock, name')
    .eq('id', params.id)
    .single();
  if (readError || !previous) {
    return NextResponse.json({ error: 'Material not found.' }, { status: 404 });
  }

  const currentStock = numberOrNull(body.currentStock);
  const update = {
    name,
    part_number: textOrNull(body.partNumber),
    description: textOrNull(body.description),
    material_type: materialType,
    equipment: textOrNull(body.equipment),
    availability_status: availability,
    current_stock: currentStock,
    minimum_stock: numberOrNull(body.minimumStock),
    suggested_stock: numberOrNull(body.suggestedStock),
    unit: textOrNull(body.unit),
    unit_cost: numberOrNull(body.unitCost),
    currency,
    provider_id: textOrNull(body.providerId),
    storage_location: textOrNull(body.storageLocation),
    notes: textOrNull(body.notes),
    catalog_locked: true,
  };

  const { data, error } = await (database.from('materials_inventory') as any)
    .update(update)
    .eq('id', params.id)
    .select(
      'id, normalized_key, name, part_number, description, material_type, equipment, quantity_text, suggested_stock, current_stock, minimum_stock, unit, supplier_reference, source_file, source_sheet, source_path, notes, availability_status, unit_cost, currency, storage_location, provider_id, catalog_locked, created_at, updated_at'
    )
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Unable to update material: ${error.message}` },
      { status: 500 }
    );
  }

  if (previous.current_stock !== currentStock) {
    await (database.from('material_stock_movements') as any).insert({
      material_id: params.id,
      movement_type: 'catalog_edit',
      amount: currentStock === null ? 0 : currentStock - Number(previous.current_stock ?? 0),
      previous_stock: previous.current_stock,
      new_stock: currentStock,
      note: 'Updated from material record.',
    });
  }

  return NextResponse.json({
    message: `${name} updated.`,
    material: data as MaterialInventoryRow,
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const database = getSupabaseAdminClient();
  const { data: material, error: readError } = await database
    .from('materials_inventory')
    .select('id, name')
    .eq('id', params.id)
    .single();
  if (readError || !material) {
    return NextResponse.json({ error: 'Material not found.' }, { status: 404 });
  }

  const { error } = await database
    .from('materials_inventory')
    .delete()
    .eq('id', params.id);
  if (error) {
    return NextResponse.json(
      { error: `Unable to delete material: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: `${material.name} deleted from the catalog.` });
}
