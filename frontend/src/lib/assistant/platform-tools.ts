import 'server-only';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

type JsonObject = Record<string, unknown>;

interface EntityConfig {
  table: string;
  label: string;
  searchable: string[];
  writable: string[];
  creatable?: string[];
  orderBy?: string;
}

const ENTITY_CONFIG = {
  client: {
    table: 'clients',
    label: 'clients',
    searchable: ['name', 'folder_slug'],
    writable: ['name', 'first_seen_year', 'last_seen_year', 'categories'],
    orderBy: 'updated_at',
  },
  document: {
    table: 'client_documents',
    label: 'client documents',
    searchable: [
      'file_name',
      'relative_path',
      'category',
      'inferred_document_number',
    ],
    writable: [
      'file_name',
      'year',
      'category',
      'inferred_document_number',
      'inferred_document_date',
    ],
    orderBy: 'updated_at',
  },
  credit_event: {
    table: 'client_credit_events',
    label: 'credit events',
    searchable: ['event_type', 'equipment', 'comment', 'source_relative_path'],
    writable: [
      'event_type',
      'event_date',
      'analyses_count',
      'equipment',
      'unit_cost',
      'amount',
      'balance_before',
      'balance_after',
      'comment',
    ],
    creatable: [
      'client_id',
      'source_type',
      'event_type',
      'event_date',
      'analyses_count',
      'equipment',
      'unit_cost',
      'amount',
      'balance_before',
      'balance_after',
      'comment',
    ],
    orderBy: 'event_date',
  },
  material: {
    table: 'materials_inventory',
    label: 'materials',
    searchable: [
      'name',
      'part_number',
      'description',
      'material_type',
      'equipment',
      'supplier_reference',
      'notes',
    ],
    writable: [
      'name',
      'part_number',
      'description',
      'material_type',
      'equipment',
      'suggested_stock',
      'current_stock',
      'minimum_stock',
      'unit',
      'supplier_reference',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  stock_movement: {
    table: 'material_stock_movements',
    label: 'stock movements',
    searchable: ['movement_type', 'note'],
    writable: ['note'],
    orderBy: 'created_at',
  },
  purchase_list: {
    table: 'material_purchase_lists',
    label: 'purchase lists',
    searchable: ['name', 'provider_name', 'provider_contact', 'notes', 'status'],
    writable: [
      'name',
      'provider_id',
      'provider_name',
      'provider_contact',
      'notes',
      'status',
    ],
    creatable: [
      'name',
      'provider_id',
      'provider_name',
      'provider_contact',
      'notes',
      'status',
    ],
    orderBy: 'updated_at',
  },
  purchase_list_item: {
    table: 'material_purchase_list_items',
    label: 'purchase-list items',
    searchable: [
      'material_name_snapshot',
      'part_number_snapshot',
      'material_type_snapshot',
      'note',
    ],
    writable: ['quantity', 'note'],
    creatable: [
      'purchase_list_id',
      'material_id',
      'quantity',
      'note',
      'material_name_snapshot',
      'part_number_snapshot',
      'material_type_snapshot',
      'unit_snapshot',
    ],
    orderBy: 'created_at',
  },
  provider: {
    table: 'providers',
    label: 'providers',
    searchable: [
      'name',
      'contact_name',
      'email',
      'phone',
      'website',
      'notes',
      'status',
    ],
    writable: [
      'name',
      'contact_name',
      'email',
      'phone',
      'website',
      'categories',
      'lead_time_days',
      'status',
      'notes',
    ],
    creatable: [
      'name',
      'contact_name',
      'email',
      'phone',
      'website',
      'categories',
      'lead_time_days',
      'status',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  provider_material: {
    table: 'provider_materials',
    label: 'provider-material links',
    searchable: ['supplier_sku', 'currency', 'notes'],
    writable: ['supplier_sku', 'unit_price', 'currency', 'preferred', 'notes'],
    creatable: [
      'provider_id',
      'material_id',
      'supplier_sku',
      'unit_price',
      'currency',
      'preferred',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  result: {
    table: 'client_results',
    label: 'client results',
    searchable: [
      'result_code',
      'sample_reference',
      'analysis_type',
      'status',
      'method',
      'instrument',
      'notes',
    ],
    writable: [
      'sample_reference',
      'analysis_type',
      'measured_at',
      'status',
      'value',
      'unit',
      'uncertainty',
      'method',
      'instrument',
      'source_document_id',
      'notes',
    ],
    creatable: [
      'client_id',
      'result_code',
      'sample_reference',
      'analysis_type',
      'measured_at',
      'status',
      'value',
      'unit',
      'uncertainty',
      'method',
      'instrument',
      'source_document_id',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  invoice: {
    table: 'client_invoices',
    label: 'invoices',
    searchable: ['invoice_number', 'status', 'currency', 'notes'],
    writable: [
      'invoice_number',
      'issue_date',
      'due_date',
      'status',
      'subtotal',
      'tax_amount',
      'total_amount',
      'currency',
      'paid_at',
      'notes',
    ],
    creatable: [
      'client_id',
      'invoice_number',
      'issue_date',
      'due_date',
      'status',
      'subtotal',
      'tax_amount',
      'total_amount',
      'currency',
      'paid_at',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  invoice_item: {
    table: 'invoice_items',
    label: 'invoice items',
    searchable: ['description'],
    writable: ['description', 'quantity', 'unit_price', 'amount'],
    creatable: ['invoice_id', 'description', 'quantity', 'unit_price', 'amount'],
    orderBy: 'created_at',
  },
  equipment: {
    table: 'equipment_assets',
    label: 'equipment assets',
    searchable: [
      'asset_code',
      'name',
      'manufacturer',
      'model',
      'serial_number',
      'location',
      'status',
      'notes',
    ],
    writable: [
      'asset_code',
      'name',
      'manufacturer',
      'model',
      'serial_number',
      'location',
      'status',
      'provider_id',
      'last_service_at',
      'next_service_at',
      'notes',
    ],
    creatable: [
      'asset_code',
      'name',
      'manufacturer',
      'model',
      'serial_number',
      'location',
      'status',
      'provider_id',
      'last_service_at',
      'next_service_at',
      'notes',
    ],
    orderBy: 'updated_at',
  },
  lab_entry: {
    table: 'lab_book_entries',
    label: 'lab-book entries',
    searchable: [
      'entry_type',
      'title',
      'status',
      'performed_by',
      'description',
      'attachment_path',
    ],
    writable: [
      'entry_type',
      'title',
      'occurred_at',
      'asset_id',
      'provider_id',
      'status',
      'performed_by',
      'description',
      'next_due_at',
      'attachment_path',
    ],
    creatable: [
      'entry_type',
      'title',
      'occurred_at',
      'asset_id',
      'provider_id',
      'status',
      'performed_by',
      'description',
      'next_due_at',
      'attachment_path',
    ],
    orderBy: 'occurred_at',
  },
  backup: {
    table: 'backup_records',
    label: 'backup records',
    searchable: ['system_name', 'backup_type', 'status', 'destination', 'notes'],
    writable: [
      'system_name',
      'backup_type',
      'started_at',
      'completed_at',
      'status',
      'destination',
      'size_bytes',
      'verified',
      'notes',
    ],
    creatable: [
      'system_name',
      'backup_type',
      'started_at',
      'completed_at',
      'status',
      'destination',
      'size_bytes',
      'verified',
      'notes',
    ],
    orderBy: 'started_at',
  },
} satisfies Record<string, EntityConfig>;

export type PlatformEntity = keyof typeof ENTITY_CONFIG;

export const PLATFORM_ENTITIES = Object.keys(ENTITY_CONFIG) as PlatformEntity[];

function isEntity(value: unknown): value is PlatformEntity {
  return typeof value === 'string' && value in ENTITY_CONFIG;
}

function readableError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown platform data error';
  return (error as { message?: string }).message ?? 'Unknown platform data error';
}

function missingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const normalized = error as { code?: string; message?: string };
  return (
    normalized.code === '42P01' ||
    (normalized.message?.toLowerCase().includes('does not exist') ?? false)
  );
}

function compactRows(rows: unknown[] | null, limit = 20): unknown[] {
  return (rows ?? []).slice(0, limit);
}

function sanitizedSearch(value: string): string {
  return value.trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').slice(0, 160);
}

async function countTable(table: string) {
  const supabase = getSupabaseAdminClient();
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    if (missingTable(error)) return { count: 0, available: false };
    throw new Error(`${table}: ${error.message}`);
  }
  return { count: count ?? 0, available: true };
}

export async function getPlatformOverview() {
  const counts = await Promise.all(
    PLATFORM_ENTITIES.map(async (entity) => [
      entity,
      await countTable(ENTITY_CONFIG[entity].table),
    ])
  );

  const supabase = getSupabaseAdminClient();
  const [
    { data: materials },
    { data: invoices },
    { data: equipment },
    { data: backups },
  ] = await Promise.all([
    supabase
      .from('materials_inventory')
      .select('id, name, current_stock, minimum_stock, unit, material_type'),
    supabase
      .from('client_invoices')
      .select('id, invoice_number, status, total_amount, currency, due_date'),
    supabase
      .from('equipment_assets')
      .select('id, asset_code, name, status, next_service_at'),
    supabase
      .from('backup_records')
      .select('id, system_name, status, verified, started_at'),
  ]);

  const now = new Date();
  const lowStock = (materials ?? []).filter((row: any) => {
    if (row.material_type !== 'consumable' || row.current_stock === null) return false;
    return row.current_stock <= (row.minimum_stock ?? 0);
  });
  const openInvoices = (invoices ?? []).filter((row: any) =>
    ['sent', 'overdue'].includes(row.status)
  );
  const serviceAttention = (equipment ?? []).filter((row: any) => {
    if (['service_due', 'out_of_service'].includes(row.status)) return true;
    return row.next_service_at && new Date(row.next_service_at) <= now;
  });
  const backupAttention = (backups ?? []).filter(
    (row: any) => row.status === 'failed' || !row.verified
  );

  return {
    generated_at: now.toISOString(),
    record_counts: Object.fromEntries(counts),
    attention: {
      low_stock_materials: compactRows(lowStock),
      open_invoices: compactRows(openInvoices),
      equipment_service: compactRows(serviceAttention),
      unverified_or_failed_backups: compactRows(backupAttention),
    },
  };
}

export async function searchPlatform(args: JsonObject) {
  const query = sanitizedSearch(String(args.query ?? ''));
  const requestedEntities = Array.isArray(args.entities)
    ? args.entities.filter(isEntity)
    : PLATFORM_ENTITIES;
  const entities = requestedEntities.length ? requestedEntities : PLATFORM_ENTITIES;
  const perEntityLimit = Math.min(Math.max(Number(args.limit) || 6, 1), 20);
  const supabase = getSupabaseAdminClient();

  const results = await Promise.all(
    entities.map(async (entity) => {
      const config = ENTITY_CONFIG[entity];
      let request: any = supabase.from(config.table).select('*');

      if (query) {
        request = request.or(
          config.searchable.map((field) => `${field}.ilike.%${query}%`).join(',')
        );
      }
      if (config.orderBy) {
        request = request.order(config.orderBy, { ascending: false, nullsFirst: false });
      }

      const { data, error } = await request.limit(perEntityLimit);
      if (error) {
        return {
          entity,
          label: config.label,
          available: !missingTable(error),
          error: missingTable(error) ? 'Table not migrated yet.' : error.message,
          records: [],
        };
      }
      return {
        entity,
        label: config.label,
        available: true,
        records: data ?? [],
      };
    })
  );

  return { query, results };
}

export async function getRecordDetails(args: JsonObject) {
  const entity = args.entity;
  const id = String(args.id ?? '').trim();
  if (!isEntity(entity)) throw new Error('Unknown entity type.');
  if (!id) throw new Error('A record id is required.');

  const config = ENTITY_CONFIG[entity];
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from(config.table)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Unable to load ${entity}: ${error.message}`);

  const related: Record<string, unknown> = {};
  if (entity === 'client') {
    const [documents, events, results, invoices] = await Promise.all([
      supabase
        .from('client_documents')
        .select('*')
        .eq('client_id', id)
        .order('inferred_document_date', { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from('client_credit_events')
        .select('*')
        .eq('client_id', id)
        .order('event_date', { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from('client_results')
        .select('*')
        .eq('client_id', id)
        .order('measured_at', { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from('client_invoices')
        .select('*')
        .eq('client_id', id)
        .order('issue_date', { ascending: false })
        .limit(50),
    ]);
    related.documents = documents.data ?? [];
    related.credit_events = events.data ?? [];
    related.results = results.data ?? [];
    related.invoices = invoices.data ?? [];
  }
  if (entity === 'material') {
    const [movements, providers, listItems] = await Promise.all([
      supabase
        .from('material_stock_movements')
        .select('*')
        .eq('material_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('provider_materials').select('*').eq('material_id', id).limit(50),
      supabase
        .from('material_purchase_list_items')
        .select('*')
        .eq('material_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    related.stock_movements = movements.data ?? [];
    related.provider_options = providers.data ?? [];
    related.purchase_list_items = listItems.data ?? [];
  }
  if (entity === 'invoice') {
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id)
      .order('created_at', { ascending: true });
    related.items = items ?? [];
  }
  if (entity === 'purchase_list') {
    const { data: items } = await supabase
      .from('material_purchase_list_items')
      .select('*')
      .eq('purchase_list_id', id)
      .order('created_at', { ascending: true });
    related.items = items ?? [];
  }

  return { entity, record: data, related };
}

function pickAllowedFields(input: unknown, allowed: string[]): JsonObject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('fields must be an object.');
  }
  return Object.fromEntries(
    Object.entries(input as JsonObject).filter(([key]) => allowed.includes(key))
  );
}

export async function updatePlatformRecord(args: JsonObject) {
  const entity = args.entity;
  const id = String(args.id ?? '').trim();
  if (!isEntity(entity)) throw new Error('Unknown entity type.');
  if (!id) throw new Error('A record id is required.');

  const config = ENTITY_CONFIG[entity];
  const fields = pickAllowedFields(args.fields, config.writable);
  if (!Object.keys(fields).length) {
    throw new Error(`No writable ${entity} fields were provided.`);
  }

  const supabase = getSupabaseAdminClient();
  const table = supabase.from(config.table) as any;
  const { data, error } = await table.update(fields).eq('id', id).select().single();
  if (error) throw new Error(`Unable to update ${entity}: ${error.message}`);
  return {
    success: true,
    action: 'updated',
    entity,
    changed_fields: Object.keys(fields),
    record: data,
  };
}

export async function createPlatformRecord(args: JsonObject) {
  const entity = args.entity;
  if (!isEntity(entity)) throw new Error('Unknown entity type.');
  const config = ENTITY_CONFIG[entity] as EntityConfig;
  if (!config.creatable) throw new Error(`Creating ${entity} records is not supported.`);

  const fields = pickAllowedFields(args.fields, config.creatable);
  if (!Object.keys(fields).length) {
    throw new Error(`No valid ${entity} fields were provided.`);
  }

  const supabase = getSupabaseAdminClient();
  const table = supabase.from(config.table) as any;
  const { data, error } = await table.insert(fields).select().single();
  if (error) throw new Error(`Unable to create ${entity}: ${error.message}`);
  return { success: true, action: 'created', entity, record: data };
}

export async function adjustMaterialStock(args: JsonObject) {
  const materialId = String(args.material_id ?? '').trim();
  const action = String(args.action ?? '');
  const amount = Number(args.amount);
  const note = typeof args.note === 'string' ? args.note.trim() || null : null;

  if (!materialId) throw new Error('material_id is required.');
  if (!['consume', 'restock', 'set_stock', 'set_minimum'].includes(action)) {
    throw new Error('action must be consume, restock, set_stock, or set_minimum.');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('amount must be a non-negative number.');
  }
  if (action !== 'set_stock' && action !== 'set_minimum' && amount === 0) {
    throw new Error('amount must be greater than zero for this action.');
  }

  const supabase = getSupabaseAdminClient();
  const { data: material, error: loadError } = await supabase
    .from('materials_inventory')
    .select('id, name, material_type, current_stock, minimum_stock')
    .eq('id', materialId)
    .single();
  if (loadError) throw new Error(`Unable to load material: ${loadError.message}`);

  const materialsTable = supabase.from('materials_inventory') as any;
  if (action === 'set_minimum') {
    const { data, error } = await materialsTable
      .update({ minimum_stock: amount })
      .eq('id', materialId)
      .select()
      .single();
    if (error) throw new Error(`Unable to update minimum stock: ${error.message}`);
    return { success: true, action, record: data };
  }

  const previousStock = Number((material as any).current_stock ?? 0);
  let nextStock = amount;
  if (action === 'consume') nextStock = Math.max(0, previousStock - amount);
  if (action === 'restock') nextStock = previousStock + amount;

  const { data, error } = await materialsTable
    .update({ current_stock: nextStock })
    .eq('id', materialId)
    .select()
    .single();
  if (error) throw new Error(`Unable to update stock: ${error.message}`);

  const movementAmount =
    action === 'consume'
      ? -amount
      : action === 'restock'
        ? amount
        : nextStock - previousStock;
  const movementTable = supabase.from('material_stock_movements') as any;
  const { error: movementError } = await movementTable.insert({
    material_id: materialId,
    movement_type: action,
    amount: movementAmount,
    previous_stock: previousStock,
    new_stock: nextStock,
    note,
  });
  if (movementError) {
    throw new Error(
      `Stock changed, but the movement log failed: ${movementError.message}`
    );
  }

  return {
    success: true,
    action,
    previous_stock: previousStock,
    current_stock: nextStock,
    record: data,
  };
}

export async function getReportData(args: JsonObject) {
  const kind = String(args.kind ?? 'executive');
  const query = String(args.query ?? '').trim();
  if (kind === 'executive') return getPlatformOverview();
  if (kind === 'client') {
    return searchPlatform({ query, entities: ['client'], limit: 20 });
  }
  if (kind === 'inventory') {
    return searchPlatform({
      query,
      entities: ['material', 'stock_movement', 'purchase_list'],
      limit: 20,
    });
  }
  if (kind === 'finance') {
    return searchPlatform({
      query,
      entities: ['invoice', 'invoice_item', 'credit_event'],
      limit: 20,
    });
  }
  if (kind === 'operations') {
    return searchPlatform({
      query,
      entities: ['equipment', 'lab_entry', 'backup', 'result'],
      limit: 20,
    });
  }
  throw new Error('Unknown report kind.');
}

export async function executePlatformTool(name: string, args: JsonObject) {
  try {
    if (name === 'get_platform_overview') return await getPlatformOverview();
    if (name === 'search_platform') return await searchPlatform(args);
    if (name === 'get_record_details') return await getRecordDetails(args);
    if (name === 'update_record_fields') return await updatePlatformRecord(args);
    if (name === 'create_record') return await createPlatformRecord(args);
    if (name === 'adjust_material_stock') return await adjustMaterialStock(args);
    if (name === 'get_report_data') return await getReportData(args);
    throw new Error(`Unknown assistant tool: ${name}`);
  } catch (error) {
    return { success: false, error: readableError(error) };
  }
}
