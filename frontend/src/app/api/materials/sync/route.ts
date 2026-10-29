import { NextResponse } from 'next/server';

import { extractMantainanceMaterials } from '@/lib/materials/extractor';
import {
  mantainancePathExists,
  resolveMantainanceRootPath,
} from '@/lib/materials/paths';
import { type MaterialType } from '@/lib/materials/types';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface ExistingMaterialRow {
  id: string;
  normalized_key: string;
  name: string;
  part_number: string | null;
  description: string | null;
  material_type: MaterialType;
  equipment: string | null;
  current_stock: number | null;
  minimum_stock: number | null;
  unit: string | null;
  notes: string | null;
  availability_status: MaterialUpsertRow['availability_status'];
  unit_cost: number | null;
  currency: string;
  storage_location: string | null;
  provider_id: string | null;
  catalog_locked: boolean;
}

interface MaterialUpsertRow {
  normalized_key: string;
  name: string;
  part_number: string | null;
  description: string | null;
  material_type: MaterialType;
  equipment: string | null;
  quantity_text: string | null;
  suggested_stock: number | null;
  current_stock: number | null;
  minimum_stock: number | null;
  unit: string | null;
  supplier_reference: string | null;
  source_file: string;
  source_sheet: string | null;
  source_path: string;
  notes: string | null;
  availability_status:
    | 'available'
    | 'low_stock'
    | 'out_of_stock'
    | 'on_order'
    | 'unavailable';
  unit_cost: number | null;
  currency: string;
  storage_location: string | null;
  provider_id: string | null;
  catalog_locked: boolean;
}

async function fetchAllExistingMaterials(
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<{ data: ExistingMaterialRow[]; error: { message: string; code?: string } | null }> {
  const pageSize = 1000;
  let pageStart = 0;
  const rows: ExistingMaterialRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from('materials_inventory')
      .select(
        'id, normalized_key, name, part_number, description, material_type, equipment, current_stock, minimum_stock, unit, notes, availability_status, unit_cost, currency, storage_location, provider_id, catalog_locked'
      )
      .range(pageStart, pageStart + pageSize - 1);

    if (error) {
      return {
        data: [],
        error: { message: error.message, code: (error as { code?: string }).code },
      };
    }

    const page = ((data ?? []) as ExistingMaterialRow[]).filter(Boolean);
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }

    pageStart += pageSize;
  }

  return { data: rows, error: null };
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
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

function defaultMinimumStock(
  materialType: MaterialType,
  suggestedStock: number | null
): number | null {
  if (materialType !== 'consumable' && materialType !== 'spare_part') {
    return null;
  }
  if (suggestedStock === null) {
    return 1;
  }
  return Math.max(1, Math.ceil(suggestedStock * 0.2));
}

function inferAvailability(
  currentStock: number | null,
  minimumStock: number | null
): MaterialUpsertRow['availability_status'] {
  if (currentStock === null) return 'available';
  if (currentStock <= 0) return 'out_of_stock';
  if (minimumStock !== null && currentStock <= minimumStock) return 'low_stock';
  return 'available';
}

function getReadableError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Unknown error';
  }
  const maybeError = error as { message?: string };
  return maybeError.message ?? 'Unknown error';
}

export async function POST() {
  try {
    const mantainanceRootPath = await resolveMantainanceRootPath();
    const exists = await mantainancePathExists(mantainanceRootPath);

    if (!exists) {
      return NextResponse.json(
        {
          error:
            'Mantainance folder was not found. Set MANTAINANCE_FOLDER_PATH to the correct absolute path.',
          mantainanceRootPath,
        },
        { status: 400 }
      );
    }

    const extracted = await extractMantainanceMaterials(mantainanceRootPath);
    const supabase = getSupabaseAdminClient();

    const { data: existingRowsData, error: existingRowsError } =
      await fetchAllExistingMaterials(supabase);

    if (existingRowsError) {
      if (hasMissingTableError(existingRowsError)) {
        return NextResponse.json(
          {
            error:
              'Supabase materials tables are missing. Apply supabase/migrations/20260308_materials_catalog.sql first.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: `Unable to fetch existing materials: ${existingRowsError.message}` },
        { status: 500 }
      );
    }

    const existingByNormalizedKey = new Map(
      ((existingRowsData ?? []) as ExistingMaterialRow[]).map((row) => [
        row.normalized_key,
        row,
      ])
    );

    const upsertRows: MaterialUpsertRow[] = extracted.materials.map((material) => {
      const existing = existingByNormalizedKey.get(material.normalizedKey);
      const currentStock = existing?.current_stock ?? material.suggestedStock;
      const locked = existing?.catalog_locked ?? false;
      const minimumStock = locked
        ? existing?.minimum_stock ??
          defaultMinimumStock(material.materialType, material.suggestedStock)
        : defaultMinimumStock(material.materialType, material.suggestedStock);

      return {
        normalized_key: material.normalizedKey,
        name: locked ? existing!.name : material.name,
        part_number: locked ? existing!.part_number : material.partNumber,
        description: locked ? existing!.description : material.description,
        material_type: locked ? existing!.material_type : material.materialType,
        equipment: locked ? existing!.equipment : material.equipment,
        quantity_text: material.quantityText,
        suggested_stock: material.suggestedStock,
        current_stock: currentStock,
        minimum_stock: minimumStock,
        unit: locked ? existing!.unit : material.unit,
        supplier_reference: material.supplierReference,
        source_file: material.sourceFile,
        source_sheet: material.sourceSheet,
        source_path: material.sourcePath,
        notes: existing?.notes ?? null,
        availability_status: locked
          ? existing!.availability_status
          : inferAvailability(currentStock, minimumStock),
        unit_cost: locked
          ? existing!.unit_cost
          : material.unitPrice ?? existing?.unit_cost ?? null,
        currency: locked
          ? existing!.currency
          : material.currency || existing?.currency || 'BRL',
        storage_location: existing?.storage_location ?? null,
        provider_id: existing?.provider_id ?? null,
        catalog_locked: locked,
      };
    });

    const currentKeys = new Set(
      extracted.materials.map((material) => material.normalizedKey)
    );
    for (const existing of existingRowsData) {
      if (currentKeys.has(existing.normalized_key)) continue;
      const { error: deleteError } = await supabase
        .from('materials_inventory')
        .delete()
        .eq('id', existing.id);
      if (deleteError) {
        return NextResponse.json(
          { error: `Unable to remove stale material: ${deleteError.message}` },
          { status: 500 }
        );
      }
    }

    for (const chunk of chunkArray(upsertRows, 200)) {
      const materialsTable = supabase.from('materials_inventory') as any;
      const { error: upsertError } = await materialsTable.upsert(chunk, {
        onConflict: 'normalized_key',
      });

      if (upsertError) {
        return NextResponse.json(
          { error: `Unable to upsert materials: ${upsertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      message: 'Maintenance materials synced to the application database.',
      sourceFolder: extracted.sourceFolder,
      mantainanceRootPath,
      extractedAt: extracted.extractedAt,
      extractedStats: extracted.stats,
      warnings: extracted.warnings,
      syncedMaterials: upsertRows.length,
      removedMaterials: existingRowsData.filter(
        (row) => !currentKeys.has(row.normalized_key)
      ).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Unexpected sync error: ${getReadableError(error)}` },
      { status: 500 }
    );
  }
}
