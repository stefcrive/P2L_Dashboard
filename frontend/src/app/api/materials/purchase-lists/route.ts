import { NextResponse } from 'next/server';

import { type MaterialInventoryRow, type MaterialType } from '@/lib/materials/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface PurchaseItemInput {
  materialId: string;
  quantity: number;
  note?: string;
}

interface PurchaseListPayload {
  name: string;
  providerName?: string;
  providerContact?: string;
  notes?: string;
  items: PurchaseItemInput[];
}

interface InsertedPurchaseList {
  id: string;
  name: string;
}

function hasMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const normalized = error as { code?: string; message?: string };
  if (normalized.code === '42P01') {
    return true;
  }

  const message = normalized.message?.toLowerCase() ?? '';
  return message.includes('does not exist');
}

function getReadableError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Unknown error';
  }
  const maybeError = error as { message?: string };
  return maybeError.message ?? 'Unknown error';
}

function normalizeItems(items: PurchaseItemInput[]): PurchaseItemInput[] {
  const byMaterialId = new Map<string, PurchaseItemInput>();

  for (const item of items) {
    const materialId = item.materialId.trim();
    const quantity = Number.parseFloat(String(item.quantity));
    if (!materialId || Number.isNaN(quantity) || quantity <= 0) {
      continue;
    }

    const existing = byMaterialId.get(materialId);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    byMaterialId.set(materialId, {
      materialId,
      quantity,
      note: typeof item.note === 'string' ? item.note.trim() || undefined : undefined,
    });
  }

  return Array.from(byMaterialId.values());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | Partial<PurchaseListPayload>
      | null;

    const listName = body?.name?.trim();
    const providerName =
      typeof body?.providerName === 'string' && body.providerName.trim()
        ? body.providerName.trim()
        : null;
    const providerContact =
      typeof body?.providerContact === 'string' && body.providerContact.trim()
        ? body.providerContact.trim()
        : null;
    const notes =
      typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const normalizedItems = normalizeItems(Array.isArray(body?.items) ? body.items : []);

    if (!listName) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    }
    if (normalizedItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid material item is required.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const purchaseListsTable = supabase.from('material_purchase_lists') as any;

    const { data: insertedList, error: listInsertError } = await purchaseListsTable
      .insert({
        name: listName,
        provider_name: providerName,
        provider_contact: providerContact,
        notes,
        status: 'draft',
      })
      .select('id, name')
      .single();

    if (listInsertError) {
      if (hasMissingTableError(listInsertError)) {
        return NextResponse.json(
          {
            error:
              'Supabase purchase list tables are missing. Apply supabase/migrations/20260308_materials_catalog.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to create purchase list: ${listInsertError.message}` },
        { status: 500 }
      );
    }

    const purchaseList = insertedList as InsertedPurchaseList;

    const materialIds = normalizedItems.map((item) => item.materialId);
    const { data: materialsData, error: materialsError } = await supabase
      .from('materials_inventory')
      .select('id, name, part_number, material_type, unit')
      .in('id', materialIds);

    if (materialsError) {
      return NextResponse.json(
        { error: `Unable to fetch materials for list items: ${materialsError.message}` },
        { status: 500 }
      );
    }

    const materialsById = new Map(
      ((materialsData ?? []) as Pick<
        MaterialInventoryRow,
        'id' | 'name' | 'part_number' | 'material_type' | 'unit'
      >[]).map((material) => [material.id, material])
    );

    const listItems = normalizedItems
      .map((item) => {
        const material = materialsById.get(item.materialId);
        if (!material) {
          return null;
        }

        return {
          purchase_list_id: purchaseList.id,
          material_id: material.id,
          quantity: item.quantity,
          note: item.note ?? null,
          material_name_snapshot: material.name,
          part_number_snapshot: material.part_number,
          material_type_snapshot: material.material_type as MaterialType,
          unit_snapshot: material.unit,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (listItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the selected materials could be loaded.' },
        { status: 400 }
      );
    }

    const purchaseListItemsTable = supabase.from('material_purchase_list_items') as any;
    const { error: itemsInsertError } = await purchaseListItemsTable.insert(listItems);

    if (itemsInsertError) {
      return NextResponse.json(
        { error: `Unable to create purchase list items: ${itemsInsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Purchase list "${purchaseList.name}" created.`,
      purchaseListId: purchaseList.id,
      itemCount: listItems.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected purchase list error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}
