import fs from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getLocalAppDatabase } from '@/lib/local-db/db';
import { getApplicationDatabaseSource } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CleanMaterial {
  normalized_key: string;
  name: string;
  part_number: string | null;
  description: string | null;
  material_type: string;
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
  availability_status: string;
  unit_cost: number | null;
  currency: string;
  storage_location: string | null;
  provider_name: string | null;
  catalog_locked: boolean;
}

interface CleanProvider {
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  categories: string[];
  notes: string | null;
}

interface CleanAsset {
  asset_code: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  status: string;
  provider_name: string | null;
  notes: string | null;
}

interface CleanCatalog {
  materials: CleanMaterial[];
  providers: CleanProvider[];
  equipment_assets: CleanAsset[];
  quality: Record<string, unknown>;
}

function repositoryRoot() {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === 'frontend'
    ? path.resolve(cwd, '..')
    : cwd;
}

function partKey(value: string | null) {
  const normalized = (value ?? '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
  if (normalized === '754960' || normalized === 'bre0000957') return 'bre0000957';
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : normalized;
}

export async function POST(request: Request) {
  if (getApplicationDatabaseSource() !== 'local') {
    return NextResponse.json(
      { error: 'The audited maintenance refresh is available only for the embedded local database.' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) {
    return NextResponse.json(
      { error: 'Set confirm=true after creating a verified database backup.' },
      { status: 400 },
    );
  }

  const catalogPath = path.join(
    repositoryRoot(),
    'tmp',
    'maintenance_cleaning',
    'clean_catalog.json',
  );
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as CleanCatalog;
  const database = await getLocalAppDatabase();

  const duplicateKeys = catalog.materials.length - new Set(catalog.materials.map((row) => row.normalized_key)).size;
  if (!catalog.materials.length || duplicateKeys || catalog.materials.some((row) => !row.name.trim())) {
    return NextResponse.json(
      { error: 'Clean catalog validation failed.', duplicateKeys },
      { status: 400 },
    );
  }

  const previous = await database.query<{ count: number }>(
    'SELECT count(*)::integer AS count FROM public.materials_inventory',
  );
  const purchaseItems = await database.query<{
    id: string;
    part_number_snapshot: string | null;
    material_name_snapshot: string;
  }>(
    `SELECT id, part_number_snapshot, material_name_snapshot
     FROM public.material_purchase_list_items`,
  );

  await database.exec('BEGIN');
  try {
    const providerIds = new Map<string, string>();
    for (const provider of catalog.providers) {
      const notes = [provider.notes, provider.address ? `Address: ${provider.address}` : null]
        .filter(Boolean)
        .join(' ');
      const result = await database.query<{ id: string }>(
        `INSERT INTO public.providers
          (name, contact_name, email, phone, website, categories, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
         ON CONFLICT (name) DO UPDATE SET
           contact_name = EXCLUDED.contact_name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           website = EXCLUDED.website,
           categories = EXCLUDED.categories,
           status = 'active',
           notes = EXCLUDED.notes,
           updated_at = now()
         RETURNING id`,
        [provider.name, provider.contact_name, provider.email, provider.phone, provider.website, provider.categories, notes || null],
      );
      providerIds.set(provider.name, result.rows[0].id);
    }

    // The requested replacement is scoped to the materials catalog. Purchase-list
    // snapshots remain intact and are relinked below when a clean match exists.
    await database.query('DELETE FROM public.materials_inventory');

    const materialIds = new Map<string, string>();
    const materialByPart = new Map<string, string>();
    const materialByName = new Map<string, string>();
    for (const material of catalog.materials) {
      const providerId = material.provider_name ? providerIds.get(material.provider_name) ?? null : null;
      const result = await database.query<{ id: string }>(
        `INSERT INTO public.materials_inventory
          (normalized_key, name, part_number, description, material_type, equipment,
           quantity_text, suggested_stock, current_stock, minimum_stock, unit,
           supplier_reference, source_file, source_sheet, source_path, notes,
           availability_status, unit_cost, currency, storage_location, provider_id,
           catalog_locked)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING id`,
        [
          material.normalized_key, material.name, material.part_number, material.description,
          material.material_type, material.equipment, material.quantity_text,
          material.suggested_stock, material.current_stock, material.minimum_stock,
          material.unit, material.supplier_reference, material.source_file,
          material.source_sheet, material.source_path, material.notes,
          material.availability_status, material.unit_cost, material.currency,
          material.storage_location, providerId, material.catalog_locked,
        ],
      );
      const id = result.rows[0].id;
      materialIds.set(material.normalized_key, id);
      if (material.part_number) materialByPart.set(partKey(material.part_number), id);
      materialByName.set(material.name.trim().toLowerCase(), id);

      if (providerId) {
        await database.query(
          `INSERT INTO public.provider_materials
            (provider_id, material_id, supplier_sku, unit_price, currency, preferred, notes)
           VALUES ($1, $2, $3, $4, $5, true, $6)`,
          [
            providerId, id, material.part_number, material.unit_cost,
            material.currency, `Preferred provider inferred from ${material.source_file}.`,
          ],
        );
      }
    }

    let relinkedPurchaseItems = 0;
    for (const item of purchaseItems.rows) {
      const materialId =
        (item.part_number_snapshot ? materialByPart.get(partKey(item.part_number_snapshot)) : undefined) ??
        materialByName.get(item.material_name_snapshot.trim().toLowerCase()) ??
        null;
      if (materialId) relinkedPurchaseItems += 1;
      await database.query(
        'UPDATE public.material_purchase_list_items SET material_id = $1 WHERE id = $2',
        [materialId, item.id],
      );
    }

    for (const asset of catalog.equipment_assets) {
      const providerId = asset.provider_name ? providerIds.get(asset.provider_name) ?? null : null;
      await database.query(
        `INSERT INTO public.equipment_assets
          (asset_code, name, manufacturer, model, status, provider_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (asset_code) DO UPDATE SET
           name = EXCLUDED.name,
           manufacturer = EXCLUDED.manufacturer,
           model = EXCLUDED.model,
           status = EXCLUDED.status,
           provider_id = EXCLUDED.provider_id,
           notes = EXCLUDED.notes,
           updated_at = now()`,
        [asset.asset_code, asset.name, asset.manufacturer, asset.model, asset.status, providerId, asset.notes],
      );
    }

    const validation = await database.query<{
      materials: number;
      duplicate_keys: number;
      missing_names: number;
      invalid_stock_rows: number;
      linked_providers: number;
    }>(
      `SELECT
         count(*)::integer AS materials,
         (count(*) - count(DISTINCT normalized_key))::integer AS duplicate_keys,
         count(*) FILTER (WHERE btrim(name) = '')::integer AS missing_names,
         count(*) FILTER (WHERE current_stock IS NOT NULL)::integer AS invalid_stock_rows,
         count(*) FILTER (WHERE provider_id IS NOT NULL)::integer AS linked_providers
       FROM public.materials_inventory`,
    );
    const checked = validation.rows[0];
    if (
      checked.materials !== catalog.materials.length ||
      checked.duplicate_keys !== 0 ||
      checked.missing_names !== 0 ||
      checked.invalid_stock_rows !== 0
    ) {
      throw new Error(`Post-refresh validation failed: ${JSON.stringify(checked)}`);
    }

    await database.exec('COMMIT');
    return NextResponse.json({
      message: 'Maintenance catalog replaced with audited clean data.',
      catalogPath,
      previousMaterials: Number(previous.rows[0]?.count ?? 0),
      insertedMaterials: checked.materials,
      linkedProviders: checked.linked_providers,
      providersUpserted: providerIds.size,
      equipmentAssetsUpserted: catalog.equipment_assets.length,
      purchaseItemsExamined: purchaseItems.rows.length,
      purchaseItemsRelinked: relinkedPurchaseItems,
      quality: catalog.quality,
    });
  } catch (error) {
    await database.exec('ROLLBACK');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Maintenance refresh failed.' },
      { status: 500 },
    );
  }
}
