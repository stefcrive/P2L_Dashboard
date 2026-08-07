import { NextResponse } from 'next/server';

import { type MaterialInventoryRow } from '@/lib/materials/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type StockAction = 'consume' | 'restock' | 'set_stock' | 'set_minimum';

interface StockPayload {
  materialId: string;
  action: StockAction;
  amount?: number;
  note?: string;
}

function isValidAction(value: string): value is StockAction {
  return (
    value === 'consume' ||
    value === 'restock' ||
    value === 'set_stock' ||
    value === 'set_minimum'
  );
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | Partial<StockPayload>
      | null;

    const materialId = body?.materialId?.trim();
    const actionRaw = body?.action?.trim() ?? '';
    const amount = parseNumber(body?.amount);
    const note =
      typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

    if (!materialId) {
      return NextResponse.json({ error: 'materialId is required.' }, { status: 400 });
    }
    if (!isValidAction(actionRaw)) {
      return NextResponse.json(
        { error: 'Invalid action. Use consume, restock, set_stock, or set_minimum.' },
        { status: 400 }
      );
    }

    if (amount === null) {
      return NextResponse.json({ error: 'amount must be a valid number.' }, { status: 400 });
    }
    if (actionRaw !== 'set_stock' && amount <= 0) {
      return NextResponse.json(
        { error: 'amount must be greater than zero for this action.' },
        { status: 400 }
      );
    }
    if (actionRaw === 'set_stock' && amount < 0) {
      return NextResponse.json(
        { error: 'amount must be zero or greater for set_stock.' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const materialsTable = supabase.from('materials_inventory') as any;
    const { data: materialData, error: materialError } = await supabase
      .from('materials_inventory')
      .select('id, name, material_type, current_stock, minimum_stock')
      .eq('id', materialId)
      .single();

    if (materialError) {
      if (hasMissingTableError(materialError)) {
        return NextResponse.json(
          {
            error:
              'Supabase materials tables are missing. Apply supabase/migrations/20260308_materials_catalog.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to load material: ${materialError.message}` },
        { status: 500 }
      );
    }

    const material = materialData as Pick<
      MaterialInventoryRow,
      'id' | 'name' | 'material_type' | 'current_stock' | 'minimum_stock'
    >;
    const previousStock = material.current_stock ?? 0;
    let nextStock = previousStock;

    if (actionRaw === 'consume') {
      if (material.material_type !== 'consumable') {
        return NextResponse.json(
          { error: 'Only consumable materials can be consumed.' },
          { status: 400 }
        );
      }
      nextStock = Math.max(0, previousStock - amount);
    }
    if (actionRaw === 'restock') {
      nextStock = previousStock + amount;
    }
    if (actionRaw === 'set_stock') {
      nextStock = amount;
    }

    if (actionRaw === 'set_minimum') {
      const { error: minimumUpdateError } = await materialsTable
        .update({ minimum_stock: amount })
        .eq('id', material.id);

      if (minimumUpdateError) {
        return NextResponse.json(
          { error: `Unable to update minimum stock: ${minimumUpdateError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        message: `Minimum stock updated for ${material.name}.`,
        materialId: material.id,
        minimumStock: amount,
      });
    }

    const { error: stockUpdateError } = await materialsTable
      .update({ current_stock: nextStock })
      .eq('id', material.id);

    if (stockUpdateError) {
      return NextResponse.json(
        { error: `Unable to update stock: ${stockUpdateError.message}` },
        { status: 500 }
      );
    }

    const movementAmount =
      actionRaw === 'consume'
        ? -amount
        : actionRaw === 'restock'
          ? amount
          : nextStock - previousStock;

    const movementsTable = supabase.from('material_stock_movements') as any;
    const { error: movementInsertError } = await movementsTable.insert({
        material_id: material.id,
        movement_type: actionRaw,
        amount: movementAmount,
        previous_stock: previousStock,
        new_stock: nextStock,
        note,
      });

    if (movementInsertError && !hasMissingTableError(movementInsertError)) {
      return NextResponse.json(
        { error: `Stock updated but movement log failed: ${movementInsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Stock updated for ${material.name}.`,
      materialId: material.id,
      previousStock,
      currentStock: nextStock,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected stock update error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}
