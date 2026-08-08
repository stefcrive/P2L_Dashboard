import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { MATERIAL_TYPES, type MaterialInventoryRow } from '@/lib/materials/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

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

function normalizedKey(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `manual:${slug || 'material'}:${randomUUID()}`;
}

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: 'Currency must use a three-letter code.' },
      { status: 400 }
    );
  }

  const currentStock = numberOrNull(body.currentStock);
  const database = getSupabaseAdminClient();
  const { data, error } = await (database.from('materials_inventory') as any)
    .insert({
      normalized_key: normalizedKey(name),
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
      source_file: 'Manual catalog entry',
      source_path: 'manual',
      catalog_locked: true,
    })
    .select(
      'id, normalized_key, name, part_number, description, material_type, equipment, quantity_text, suggested_stock, current_stock, minimum_stock, unit, supplier_reference, source_file, source_sheet, source_path, notes, availability_status, unit_cost, currency, storage_location, provider_id, catalog_locked, created_at, updated_at'
    )
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Unable to add material: ${error.message}` },
      { status: 500 }
    );
  }

  if (currentStock !== null) {
    await (database.from('material_stock_movements') as any).insert({
      material_id: data.id,
      movement_type: 'catalog_create',
      amount: currentStock,
      previous_stock: null,
      new_stock: currentStock,
      note: 'Initial stock from manual catalog entry.',
    });
  }

  return NextResponse.json(
    {
      message: `${name} added to the catalog.`,
      material: data as MaterialInventoryRow,
    },
    { status: 201 }
  );
}
