import { NextResponse } from 'next/server';

import { extractMantainanceMaterials } from '@/lib/materials/extractor';
import {
  mantainancePathExists,
  resolveMantainanceRootPath,
} from '@/lib/materials/paths';
import {
  MATERIAL_TYPES,
  type MaterialInventoryRow,
  type MaterialPurchaseListItemRow,
  type MaterialPurchaseListRow,
  type MaterialPurchaseListWithItems,
  type MaterialType,
  type MaterialsCatalogDataResponse,
} from '@/lib/materials/types';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface QueryFilters {
  search: string;
  type: MaterialType | null;
  equipment: string | null;
  lowStockOnly: boolean;
}

async function fetchAllMaterials(
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<{ data: MaterialInventoryRow[]; error: { message: string; code?: string } | null }> {
  const pageSize = 1000;
  let pageStart = 0;
  const rows: MaterialInventoryRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from('materials_inventory')
      .select(
        'id, normalized_key, name, part_number, description, material_type, equipment, quantity_text, suggested_stock, current_stock, minimum_stock, unit, supplier_reference, source_file, source_sheet, source_path, notes, availability_status, unit_cost, currency, storage_location, provider_id, catalog_locked, created_at, updated_at'
      )
      .order('name', { ascending: true })
      .range(pageStart, pageStart + pageSize - 1);

    if (error) {
      return {
        data: [],
        error: { message: error.message, code: (error as { code?: string }).code },
      };
    }

    const page = ((data ?? []) as MaterialInventoryRow[]).filter(Boolean);
    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }

    pageStart += pageSize;
  }

  return { data: rows, error: null };
}

function parseFilters(request: Request): QueryFilters {
  const searchParams = new URL(request.url).searchParams;
  const rawSearch = (searchParams.get('q') ?? '').trim();
  const rawType = (searchParams.get('type') ?? '').trim();
  const rawEquipment = (searchParams.get('equipment') ?? '').trim();
  const rawLowStockOnly = (searchParams.get('lowStockOnly') ?? '').trim();

  const parsedType = MATERIAL_TYPES.includes(rawType as MaterialType)
    ? (rawType as MaterialType)
    : null;

  return {
    search: rawSearch.toLowerCase(),
    type: parsedType,
    equipment: rawEquipment && rawEquipment !== 'all' ? rawEquipment : null,
    lowStockOnly: rawLowStockOnly === '1' || rawLowStockOnly === 'true',
  };
}

function defaultMinimumStock(material: MaterialInventoryRow): number | null {
  if (material.material_type !== 'consumable') {
    return null;
  }
  if (material.minimum_stock !== null) {
    return material.minimum_stock;
  }
  if (material.current_stock !== null) {
    return Math.max(1, Math.ceil(material.current_stock * 0.2));
  }
  if (material.suggested_stock !== null) {
    return Math.max(1, Math.ceil(material.suggested_stock * 0.2));
  }
  return 1;
}

function isLowStockConsumable(material: MaterialInventoryRow): boolean {
  if (material.material_type !== 'consumable') {
    return false;
  }
  if (material.current_stock === null) {
    return false;
  }

  const minimum = defaultMinimumStock(material) ?? 0;
  return material.current_stock <= minimum;
}

function applyFilters(
  materials: MaterialInventoryRow[],
  filters: QueryFilters
): MaterialInventoryRow[] {
  return materials
    .filter((material) => {
      if (filters.type && material.material_type !== filters.type) {
        return false;
      }

      if (filters.equipment && (material.equipment ?? 'General Lab') !== filters.equipment) {
        return false;
      }

      if (filters.lowStockOnly && !isLowStockConsumable(material)) {
        return false;
      }

      if (!filters.search) {
        return true;
      }

      const values = [
        material.name,
        material.part_number ?? '',
        material.description ?? '',
        material.equipment ?? '',
        material.supplier_reference ?? '',
        material.source_file,
      ];

      return values.some((value) => value.toLowerCase().includes(filters.search));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildPurchaseLists(
  lists: MaterialPurchaseListRow[],
  items: MaterialPurchaseListItemRow[]
): MaterialPurchaseListWithItems[] {
  const itemsByListId = new Map<string, MaterialPurchaseListItemRow[]>();

  for (const item of items) {
    const bucket = itemsByListId.get(item.purchase_list_id) ?? [];
    bucket.push(item);
    itemsByListId.set(item.purchase_list_id, bucket);
  }

  return lists.map((list) => ({
    ...list,
    items: itemsByListId.get(list.id) ?? [],
  }));
}

function buildResponse(
  source: 'local' | 'supabase' | 'filesystem',
  warnings: string[],
  allMaterials: MaterialInventoryRow[],
  purchaseLists: MaterialPurchaseListWithItems[],
  providers: Array<{ id: string; name: string }>,
  equipmentOptions: MaterialsCatalogDataResponse['equipmentOptions'],
  filters: QueryFilters
): MaterialsCatalogDataResponse {
  const materials = applyFilters(allMaterials, filters);

  const availableTypes = MATERIAL_TYPES.filter((type) =>
    allMaterials.some((material) => material.material_type === type)
  );
  const availableEquipment = Array.from(
    new Set([
      ...equipmentOptions.map((equipment) => equipment.name),
      ...allMaterials.map((material) => material.equipment ?? 'General Lab'),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const totalConsumables = materials.filter(
    (material) => material.material_type === 'consumable'
  ).length;
  const totalEquipment = materials.filter(
    (material) => material.material_type === 'equipment'
  ).length;
  const totalSpareParts = materials.filter(
    (material) => material.material_type === 'spare_part'
  ).length;
  const lowStockConsumables = materials.filter(isLowStockConsumable).length;
  const trackedConsumables = materials.filter(
    (material) =>
      material.material_type === 'consumable' && material.current_stock !== null
  ).length;

  return {
    source,
    warnings,
    availableTypes,
    availableEquipment,
    equipmentOptions,
    materials,
    purchaseLists,
    providers,
    stats: {
      totalMaterials: materials.length,
      totalConsumables,
      totalEquipment,
      totalSpareParts,
      lowStockConsumables,
      trackedConsumables,
      totalPurchaseLists: purchaseLists.length,
    },
  };
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

async function triggerAutomaticSync(
  request: Request,
  syncPath: string
): Promise<string | null> {
  try {
    const syncUrl = new URL(syncPath, request.url);
    const response = await fetch(syncUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'x-p2l-auto-sync': '1',
      },
    });

    if (response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    return payload?.error ?? `Request failed with status ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}

function inferMinimumForFilesystemRow(
  materialType: MaterialType,
  suggestedStock: number | null
): number | null {
  if (materialType !== 'consumable') {
    return null;
  }
  if (suggestedStock === null) {
    return 1;
  }
  return Math.max(1, Math.ceil(suggestedStock * 0.2));
}

async function getFilesystemFallback(
  filters: QueryFilters,
  warnings: string[]
): Promise<MaterialsCatalogDataResponse> {
  const mantainanceRootPath = await resolveMantainanceRootPath();
  const exists = await mantainancePathExists(mantainanceRootPath);
  if (!exists) {
    return buildResponse('filesystem', warnings, [], [], [], [], filters);
  }

  const extracted = await extractMantainanceMaterials(mantainanceRootPath);
  const materials: MaterialInventoryRow[] = extracted.materials.map((material, index) => ({
    id: `fs-material-${index + 1}`,
    normalized_key: material.normalizedKey,
    name: material.name,
    part_number: material.partNumber,
    description: material.description,
    material_type: material.materialType,
    equipment: material.equipment,
    quantity_text: material.quantityText,
    suggested_stock: material.suggestedStock,
    current_stock: material.suggestedStock,
    minimum_stock: inferMinimumForFilesystemRow(
      material.materialType,
      material.suggestedStock
    ),
    unit: material.unit,
    availability_status:
      material.suggestedStock !== null && material.suggestedStock <= 0
        ? 'out_of_stock'
        : 'available',
    unit_cost: material.unitPrice,
    currency: material.currency,
    storage_location: null,
    provider_id: null,
    catalog_locked: false,
    supplier_reference: material.supplierReference,
    source_file: material.sourceFile,
    source_sheet: material.sourceSheet,
    source_path: material.sourcePath,
    notes: null,
    created_at: extracted.extractedAt,
    updated_at: extracted.extractedAt,
  }));

  return buildResponse(
    'filesystem',
    [...warnings, ...extracted.warnings],
    materials,
    [],
    [],
    [],
    filters
  );
}

export async function GET(request: Request) {
  const filters = parseFilters(request);

  try {
    const supabase = getSupabaseAdminClient();
    const warnings: string[] = [];

    let { data: materialsData, error: materialsError } =
      await fetchAllMaterials(supabase);

    if (materialsError) {
      if (hasMissingTableError(materialsError)) {
        return NextResponse.json(
          await getFilesystemFallback(filters, [
            `${materialsError.message}`,
            'Supabase materials tables are missing. Apply supabase/migrations/20260308_materials_catalog.sql. Automatic sync runs on startup after migration.',
          ])
        );
      }

      return NextResponse.json(
        { error: `Unable to load materials: ${materialsError.message}` },
        { status: 500 }
      );
    }

    if (materialsData.length === 0) {
      const syncWarning = await triggerAutomaticSync(request, '/api/materials/sync');
      if (syncWarning) {
        warnings.push(`Automatic startup sync failed: ${syncWarning}`);
      } else {
        const refreshed = await fetchAllMaterials(supabase);
        materialsData = refreshed.data;
        materialsError = refreshed.error;

        if (materialsError) {
          return NextResponse.json(
            {
              error: `Unable to load materials after automatic sync: ${materialsError.message}`,
            },
            { status: 500 }
          );
        }
      }
    }

    const { data: purchaseListsData, error: purchaseListsError } = await supabase
      .from('material_purchase_lists')
      .select(
        'id, name, provider_name, provider_contact, notes, status, created_at, updated_at'
      )
      .order('created_at', { ascending: false })
      .limit(50);

    let purchaseListRows: MaterialPurchaseListRow[] = [];
    let purchaseListItemRows: MaterialPurchaseListItemRow[] = [];
    const { data: providersData, error: providersError } = await supabase
      .from('providers')
      .select('id, name')
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (providersError) {
      return NextResponse.json(
        { error: `Unable to load providers: ${providersError.message}` },
        { status: 500 }
      );
    }

    const { data: equipmentData, error: equipmentError } = await supabase
      .from('equipment_assets')
      .select('id, asset_code, name, status')
      .neq('status', 'retired')
      .order('name', { ascending: true });
    if (equipmentError) {
      return NextResponse.json(
        { error: `Unable to load equipment portfolio: ${equipmentError.message}` },
        { status: 500 }
      );
    }

    if (purchaseListsError) {
      if (!hasMissingTableError(purchaseListsError)) {
        return NextResponse.json(
          { error: `Unable to load purchase lists: ${purchaseListsError.message}` },
          { status: 500 }
        );
      }

      warnings.push(
        'Purchase list tables are missing. Apply supabase/migrations/20260308_materials_catalog.sql to enable custom lists.'
      );
    } else {
      purchaseListRows = (purchaseListsData ?? []) as MaterialPurchaseListRow[];
      const purchaseListIds = purchaseListRows.map((list) => list.id);

      if (purchaseListIds.length > 0) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('material_purchase_list_items')
          .select(
            'id, purchase_list_id, material_id, quantity, note, material_name_snapshot, part_number_snapshot, material_type_snapshot, unit_snapshot, created_at'
          )
          .in('purchase_list_id', purchaseListIds)
          .order('created_at', { ascending: true });

        if (itemsError) {
          if (!hasMissingTableError(itemsError)) {
            return NextResponse.json(
              { error: `Unable to load purchase list items: ${itemsError.message}` },
              { status: 500 }
            );
          }

          warnings.push(
            'Purchase list item table is missing. Apply supabase/migrations/20260308_materials_catalog.sql to enable custom lists.'
          );
        } else {
          purchaseListItemRows = (itemsData ?? []) as MaterialPurchaseListItemRow[];
        }
      }
    }

    return NextResponse.json(
      buildResponse(
        getApplicationDatabaseSource(),
        warnings,
        (materialsData ?? []) as MaterialInventoryRow[],
        buildPurchaseLists(purchaseListRows, purchaseListItemRows),
        (providersData ?? []) as Array<{ id: string; name: string }>,
        ((equipmentData ?? []) as Array<{
          id: string;
          asset_code: string;
          name: string;
          status: 'active' | 'service_due' | 'out_of_service' | 'retired';
        }>).map((equipment) => ({
          id: equipment.id,
          assetCode: equipment.asset_code,
          name: equipment.name,
          status: equipment.status,
        })),
        filters
      )
    );
  } catch (error) {
    return NextResponse.json(
      await getFilesystemFallback(filters, [
        `Unable to load application database data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      ])
    );
  }
}
