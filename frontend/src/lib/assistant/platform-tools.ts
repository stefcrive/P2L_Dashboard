import 'server-only';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  attachAssistantUploadToClient,
  importAssistantResultUpload,
} from '@/lib/assistant/uploads';
import {
  createGmailDraft,
  readGmailMessage,
  searchGmail,
  sendGmailMessage,
} from '@/lib/gmail/client';
import { resolveClientiRootPath } from '@/lib/client-manager/paths';
import {
  createQueueItem,
  deleteQueueItem,
  listQueueItems,
  planActiveQueue,
  QUEUE_WRITABLE_FIELDS,
  reorderQueueItems,
  updateQueueItem,
} from '@/lib/queue/service';
import {
  brazilLabHolidayName,
  countQueueWorkingDays,
  isQueueWorkingDay,
  nextQueueWorkingDay,
  queueDateAtNineUtc,
  queueDateKey,
} from '@/lib/queue/calendar';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

type JsonObject = Record<string, unknown>;

interface EntityConfig {
  table: string;
  label: string;
  searchable: string[];
  writable: string[];
  creatable?: string[];
  orderBy?: string;
  orderAscending?: boolean;
}

const ENTITY_CONFIG = {
  client: {
    table: 'clients',
    label: 'clients',
    searchable: [
      'name',
      'folder_slug',
      'billing_details',
      'email',
      'phone',
      'tax_id',
    ],
    writable: [
      'name',
      'folder_slug',
      'billing_details',
      'email',
      'phone',
      'tax_id',
      'first_seen_year',
      'last_seen_year',
      'total_documents',
      'categories',
    ],
    creatable: [
      'name',
      'folder_slug',
      'billing_details',
      'email',
      'phone',
      'tax_id',
      'first_seen_year',
      'last_seen_year',
      'total_documents',
      'categories',
    ],
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
      'client_id',
      'file_name',
      'relative_path',
      'absolute_path',
      'year',
      'extension',
      'category',
      'inferred_document_number',
      'inferred_document_date',
      'file_size_bytes',
    ],
    creatable: [
      'client_id',
      'file_name',
      'relative_path',
      'absolute_path',
      'year',
      'extension',
      'category',
      'inferred_document_number',
      'inferred_document_date',
      'file_size_bytes',
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
    creatable: [
      'normalized_key',
      'name',
      'part_number',
      'description',
      'material_type',
      'equipment',
      'quantity_text',
      'suggested_stock',
      'current_stock',
      'minimum_stock',
      'unit',
      'supplier_reference',
      'source_file',
      'source_sheet',
      'source_path',
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
  queue_item: {
    table: 'sample_queue_items',
    label: 'sample queue items',
    searchable: [
      'queue_code',
      'sample_label',
      'analysis_type',
      'matrix',
      'priority',
      'status',
      'operator',
      'notes',
    ],
    writable: [...QUEUE_WRITABLE_FIELDS, 'segments'],
    creatable: QUEUE_WRITABLE_FIELDS,
    orderBy: 'queue_position',
    orderAscending: true,
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

const ACTIVE_QUEUE_STATUSES = new Set(['queued', 'analysing']);

function queueDurationDays(sampleCount: unknown, samplesPerWeek: unknown) {
  const count = Number(sampleCount);
  const rate = Number(samplesPerWeek);
  if (!Number.isFinite(count) || !Number.isFinite(rate) || count < 1 || rate <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil((count / rate) * 5));
}

function optionalQueueDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return queueDateAtNineUtc(date);
}

function queueTemporalState(start: Date, end: Date, today: Date) {
  if (end < today) return 'past';
  if (start <= today) return 'current';
  return 'future';
}

function queueSearchText(item: any) {
  return [
    item.queue_code,
    item.sample_label,
    item.analysis_type,
    item.matrix,
    item.priority,
    item.status,
    item.operator,
    item.notes,
    item.client?.name,
    item.asset?.asset_code,
    item.asset?.name,
    ...(item.segments ?? []).flatMap((segment: any) => [
      segment.id,
      segment.start_at,
      segment.end_at,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

export async function getQueueSchedule(args: JsonObject = {}) {
  const requestedScope = String(args.scope ?? 'active');
  if (!['active', 'future', 'all'].includes(requestedScope)) {
    throw new Error('Queue schedule scope must be active, future, or all.');
  }
  const fromDate = optionalQueueDate(args.from_date, 'from_date');
  const toDate = optionalQueueDate(args.to_date, 'to_date');
  if (fromDate && toDate && toDate < fromDate) {
    throw new Error('to_date cannot be before from_date.');
  }

  const today = queueDateAtNineUtc(new Date());
  const allItems = await listQueueItems();
  const selectedItems = allItems.filter((item: any) =>
    requestedScope === 'all' || ACTIVE_QUEUE_STATUSES.has(String(item.status))
  );
  const itemScheduledDays = new Map<string, number>();
  for (const item of selectedItems) {
    itemScheduledDays.set(
      String(item.id),
      (item.segments ?? []).reduce(
        (sum: number, segment: any) =>
          sum +
          countQueueWorkingDays(
            new Date(segment.start_at),
            new Date(segment.end_at)
          ),
        0
      )
    );
  }

  const runs = selectedItems
    .flatMap((item: any) =>
      (item.segments ?? []).map((segment: any, index: number) => ({
        item,
        segment,
        runNumber: index + 1,
        runCount: item.segments.length,
      }))
    )
    .filter(({ segment }: any) => {
      const start = new Date(segment.start_at);
      const end = new Date(segment.end_at);
      if (requestedScope === 'future' && start <= today) return false;
      if (fromDate && end < fromDate) return false;
      if (toDate && start > toDate) return false;
      return true;
    })
    .sort(
      (left: any, right: any) =>
        Number(left.segment.run_position) - Number(right.segment.run_position)
    );

  const monthly = new Map<
    string,
    { scheduled_working_days: number; run_ids: Set<string>; queue_item_ids: Set<string> }
  >();
  const runSummaries = runs.map(({ item, segment, runNumber, runCount }: any) => {
    const start = queueDateAtNineUtc(new Date(segment.start_at));
    const end = queueDateAtNineUtc(new Date(segment.end_at));
    const holidays: Array<{ date: string; name: string }> = [];
    const cursor = new Date(start);
    let inspectedDays = 0;
    while (cursor <= end && inspectedDays < 5000) {
      if (isQueueWorkingDay(cursor)) {
        const month = queueDateKey(cursor).slice(0, 7);
        const bucket = monthly.get(month) ?? {
          scheduled_working_days: 0,
          run_ids: new Set<string>(),
          queue_item_ids: new Set<string>(),
        };
        bucket.scheduled_working_days += 1;
        bucket.run_ids.add(String(segment.id));
        bucket.queue_item_ids.add(String(item.id));
        monthly.set(month, bucket);
      } else {
        const holiday = brazilLabHolidayName(cursor);
        if (holiday) holidays.push({ date: queueDateKey(cursor), name: holiday });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      inspectedDays += 1;
    }
    const expectedWorkingDays = queueDurationDays(
      item.sample_count,
      item.samples_per_week
    );
    return {
      run_id: segment.id,
      queue_item_id: item.id,
      queue_code: item.queue_code,
      client_name: item.client?.name ?? null,
      identifiers: item.sample_label,
      status: item.status,
      priority: item.priority,
      instrument: item.asset
        ? {
            id: item.asset.id,
            code: item.asset.asset_code,
            name: item.asset.name,
          }
        : null,
      run_position: Number(segment.run_position),
      run_number: runNumber,
      run_count: runCount,
      is_split: runCount > 1,
      start_at: segment.start_at,
      end_at: segment.end_at,
      temporal_state: queueTemporalState(start, end, today),
      scheduled_working_days: countQueueWorkingDays(start, end),
      item_expected_working_days: expectedWorkingDays,
      item_total_scheduled_working_days:
        itemScheduledDays.get(String(item.id)) ?? 0,
      sample_count: Number(item.sample_count),
      samples_per_week: Number(item.samples_per_week),
      starts_on_working_day: isQueueWorkingDay(start),
      ends_on_working_day: isQueueWorkingDay(end),
      holidays_skipped_inside_run: holidays,
    };
  });

  const activeRuns = runSummaries.filter((run) =>
    ACTIVE_QUEUE_STATUSES.has(String(run.status))
  );
  const futureRuns = activeRuns.filter((run) => run.temporal_state === 'future');
  const gaps = futureRuns.slice(1).flatMap((run, index) => {
    const previous = futureRuns[index];
    const expected = nextQueueWorkingDay(new Date(previous.end_at));
    return queueDateAtNineUtc(new Date(run.start_at)).getTime() === expected.getTime()
      ? []
      : [
          {
            after_run_id: previous.run_id,
            before_run_id: run.run_id,
            expected_next_start: expected.toISOString(),
            actual_start: run.start_at,
          },
        ];
  });
  const overlaps: Array<{
    first_run_id: string;
    second_run_id: string;
    same_instrument: boolean;
  }> = [];
  for (let left = 0; left < activeRuns.length; left += 1) {
    for (let right = left + 1; right < activeRuns.length; right += 1) {
      const first = activeRuns[left];
      const second = activeRuns[right];
      if (
        new Date(first.start_at) <= new Date(second.end_at) &&
        new Date(first.end_at) >= new Date(second.start_at)
      ) {
        overlaps.push({
          first_run_id: first.run_id,
          second_run_id: second.run_id,
          same_instrument:
            Boolean(first.instrument?.id) &&
            first.instrument?.id === second.instrument?.id,
        });
      }
    }
  }
  const durationIssues = selectedItems.flatMap((item: any) => {
    const expected = queueDurationDays(item.sample_count, item.samples_per_week);
    const scheduled = itemScheduledDays.get(String(item.id)) ?? 0;
    return expected !== null && expected !== scheduled
      ? [
          {
            queue_item_id: item.id,
            identifiers: item.sample_label,
            expected_working_days: expected,
            scheduled_working_days: scheduled,
          },
        ]
      : [];
  });
  const workingDayIssues = runSummaries
    .filter((run) => !run.starts_on_working_day || !run.ends_on_working_day)
    .map((run) => run.run_id);
  const calendarOrder = [...futureRuns]
    .sort(
      (left, right) =>
        new Date(left.start_at).getTime() - new Date(right.start_at).getTime() ||
        left.run_position - right.run_position
    )
    .map((run) => run.run_id);
  const runwayOrder = futureRuns.map((run) => run.run_id);

  return {
    generated_at: new Date().toISOString(),
    today: queueDateKey(today),
    scope: requestedScope,
    planning_rules: {
      duration_formula:
        'ceil(sample_count / samples_per_week * 5) working days per queue item',
      working_week: 'Monday through Friday',
      excluded_days:
        'Weekends plus Brazil federal and Sao Paulo laboratory holidays',
      fixed_runs: 'Runs starting today or earlier are not moved by planning',
      future_order:
        'Future active runs follow run_position; split runs share their parent item duration',
      concurrency:
        'The planner places future runs in one sequence, so queue runs do not overlap',
    },
    summary: {
      queue_items: selectedItems.length,
      runs: runSummaries.length,
      split_queue_items: selectedItems.filter(
        (item: any) => (item.segments ?? []).length > 1
      ).length,
      past_runs: runSummaries.filter((run) => run.temporal_state === 'past').length,
      current_runs: runSummaries.filter((run) => run.temporal_state === 'current')
        .length,
      future_runs: futureRuns.length,
      first_future_start: futureRuns[0]?.start_at ?? null,
      last_future_end: futureRuns.at(-1)?.end_at ?? null,
    },
    calendar_distribution: Array.from(monthly.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, bucket]) => ({
        month,
        scheduled_working_days: bucket.scheduled_working_days,
        run_count: bucket.run_ids.size,
        queue_item_count: bucket.queue_item_ids.size,
      })),
    validation: {
      runway_matches_calendar_order:
        runwayOrder.join('|') === calendarOrder.join('|'),
      gaps,
      overlaps,
      working_day_issue_run_ids: workingDayIssues,
      duration_issues: durationIssues,
    },
    run_order_ids: runSummaries.map((run) => run.run_id).join('|'),
    runs: runSummaries,
  };
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
      const config: EntityConfig = ENTITY_CONFIG[entity];
      if (entity === 'queue_item') {
        const normalizedQuery = query.toLocaleLowerCase();
        const records = (await listQueueItems())
          .filter(
            (item: any) =>
              !normalizedQuery || queueSearchText(item).includes(normalizedQuery)
          )
          .slice(0, perEntityLimit);
        return {
          entity,
          label: config.label,
          available: true,
          records,
        };
      }
      let request: any = supabase.from(config.table).select('*');

      if (query) {
        request = request.or(
          config.searchable.map((field) => `${field}.ilike.%${query}%`).join(',')
        );
      }
      if (config.orderBy) {
        request = request.order(config.orderBy, {
          ascending: config.orderAscending ?? false,
          nullsFirst: false,
        });
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
  if (entity === 'queue_item') {
    const record = (await listQueueItems()).find((item: any) => String(item.id) === id);
    if (!record) throw new Error('Unable to load queue_item: record not found.');
    return {
      entity,
      record,
      related: {
        calendar: {
          expected_working_days: queueDurationDays(
            record.sample_count,
            record.samples_per_week
          ),
          scheduled_working_days: (record.segments ?? []).reduce(
            (sum: number, segment: any) =>
              sum +
              countQueueWorkingDays(
                new Date(segment.start_at),
                new Date(segment.end_at)
              ),
            0
          ),
          runs: record.segments ?? [],
        },
      },
    };
  }
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

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCreditEventAmount(eventType: string, amount: number | null) {
  if (amount === null) return null;
  const absoluteAmount = Math.abs(amount);
  if (eventType === 'analysis') return -absoluteAmount;
  if (eventType === 'credit_topup') return absoluteAmount;
  return amount;
}

function deriveCreditEventAmount(
  eventType: string,
  analysesCount: number | null,
  unitCost: number | null,
  amountOverride: number | null
) {
  if (amountOverride !== null) {
    return normalizeCreditEventAmount(eventType, amountOverride);
  }
  if (analysesCount === null || unitCost === null) return null;
  return normalizeCreditEventAmount(eventType, analysesCount * unitCost);
}

async function refreshClientRollup(clientId: string | null | undefined) {
  if (!clientId) return;
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('client_documents')
    .select('category, year')
    .eq('client_id', clientId);
  if (error) throw new Error(`Unable to refresh client document totals: ${error.message}`);

  const rows = (data ?? []) as Array<{ category: string; year: number | null }>;
  const years = rows
    .map((row) => row.year)
    .filter((year): year is number => typeof year === 'number');
  const categories = Array.from(new Set(rows.map((row) => row.category).filter(Boolean)));
  const clientsTable = supabase.from('clients') as any;
  const { error: updateError } = await clientsTable
    .update({
      total_documents: rows.length,
      categories,
      first_seen_year: years.length ? Math.min(...years) : null,
      last_seen_year: years.length ? Math.max(...years) : null,
    })
    .eq('id', clientId);
  if (updateError) {
    throw new Error(`Unable to update client document totals: ${updateError.message}`);
  }
}

async function rebalanceClientCreditEvents(clientId: string | null | undefined) {
  if (!clientId) return;
  const supabase = getSupabaseAdminClient();
  const table = supabase.from('client_credit_events') as any;
  const { data, error } = await table
    .select('id, source_type, amount, balance_before, balance_after, event_date, created_at')
    .eq('client_id', clientId)
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Unable to rebalance the client ledger: ${error.message}`);

  let runningBalance: number | null = null;
  for (const event of data ?? []) {
    const amount = nullableNumber(event.amount) ?? 0;
    const storedBefore = nullableNumber(event.balance_before);
    const storedAfter = nullableNumber(event.balance_after);
    if (event.source_type === 'spreadsheet') {
      if (storedAfter !== null) runningBalance = storedAfter;
      else if (storedBefore !== null) runningBalance = storedBefore + amount;
      continue;
    }

    const balanceBefore = runningBalance ?? 0;
    const balanceAfter = balanceBefore + amount;
    if (storedBefore !== balanceBefore || storedAfter !== balanceAfter) {
      const { error: updateError } = await table
        .update({ balance_before: balanceBefore, balance_after: balanceAfter })
        .eq('id', event.id);
      if (updateError) {
        throw new Error(`Unable to rebalance the client ledger: ${updateError.message}`);
      }
    }
    runningBalance = balanceAfter;
  }
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

  if (entity === 'queue_item') {
    const result = await updateQueueItem(id, fields);
    return {
      success: true,
      action: 'updated',
      entity,
      changed_fields: Object.keys(fields),
      record: result.data,
      sync_warning: result.syncWarning,
    };
  }

  const supabase = getSupabaseAdminClient();
  const table = supabase.from(config.table) as any;
  let previousRecord: Record<string, unknown> | null = null;
  if (entity === 'credit_event' || entity === 'document') {
    const { data: existing, error: existingError } = await table
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existingError) throw new Error(`Unable to load ${entity}: ${existingError.message}`);
    previousRecord = existing;
  }
  if (entity === 'credit_event') {
    const eventType = String(fields.event_type ?? previousRecord?.event_type ?? 'adjustment');
    const analysesCount = nullableNumber(
      fields.analyses_count ?? previousRecord?.analyses_count
    );
    const unitCost = nullableNumber(fields.unit_cost ?? previousRecord?.unit_cost);
    const shouldRecalculate =
      Object.prototype.hasOwnProperty.call(fields, 'amount') ||
      Object.prototype.hasOwnProperty.call(fields, 'analyses_count') ||
      Object.prototype.hasOwnProperty.call(fields, 'unit_cost');

    if (shouldRecalculate) {
      fields.amount = deriveCreditEventAmount(
        eventType,
        analysesCount,
        unitCost,
        Object.prototype.hasOwnProperty.call(fields, 'amount')
          ? nullableNumber(fields.amount)
          : null
      );
    } else if (Object.prototype.hasOwnProperty.call(fields, 'event_type')) {
      fields.amount = normalizeCreditEventAmount(
        eventType,
        nullableNumber(previousRecord?.amount)
      );
    }
  }
  const { data, error } = await table.update(fields).eq('id', id).select().single();
  if (error) throw new Error(`Unable to update ${entity}: ${error.message}`);
  if (entity === 'credit_event') {
    await rebalanceClientCreditEvents(String(data.client_id ?? previousRecord?.client_id ?? ''));
  }
  if (entity === 'document') {
    await refreshClientRollup(String(previousRecord?.client_id ?? ''));
    await refreshClientRollup(String(data.client_id ?? ''));
  }
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

  if (entity === 'queue_item') {
    const result = await createQueueItem(fields);
    return {
      success: true,
      action: 'created',
      entity,
      record: result.data,
      sync_warning: result.syncWarning,
    };
  }

  if (entity === 'client') {
    const name = String(fields.name ?? '').trim();
    if (!name) throw new Error('A client name is required.');
    fields.name = name;
    fields.folder_slug =
      String(fields.folder_slug ?? '').trim() || slugify(name, 'client');
    fields.categories = Array.isArray(fields.categories) ? fields.categories : [];
  }
  if (entity === 'material') {
    const name = String(fields.name ?? '').trim();
    if (!name) throw new Error('A material name is required.');
    fields.name = name;
    fields.normalized_key =
      String(fields.normalized_key ?? '').trim() ||
      `assistant-${slugify(`${name}-${String(fields.part_number ?? '')}`, 'material')}-${Date.now()}`;
    fields.material_type = String(fields.material_type ?? '').trim() || 'other';
    fields.source_file = String(fields.source_file ?? '').trim() || 'Assistant';
    fields.source_path = String(fields.source_path ?? '').trim() || 'assistant';
  }
  if (entity === 'credit_event') {
    const clientId = String(fields.client_id ?? '').trim();
    if (!clientId) throw new Error('client_id is required for a credit event.');
    fields.client_id = clientId;
    fields.source_type = 'manual';
    fields.source_sheet = '';
    const eventType = String(fields.event_type ?? 'adjustment');
    fields.amount = deriveCreditEventAmount(
      eventType,
      nullableNumber(fields.analyses_count),
      nullableNumber(fields.unit_cost),
      nullableNumber(fields.amount)
    );
    fields.balance_before = null;
    fields.balance_after = null;
  }

  const supabase = getSupabaseAdminClient();
  const table = supabase.from(config.table) as any;
  const { data, error } = await table.insert(fields).select().single();
  if (error) throw new Error(`Unable to create ${entity}: ${error.message}`);
  if (entity === 'credit_event') await rebalanceClientCreditEvents(String(data.client_id));
  if (entity === 'document') await refreshClientRollup(String(data.client_id));
  return { success: true, action: 'created', entity, record: data };
}

const DELETABLE_ENTITIES = new Set<PlatformEntity>([
  'client',
  'document',
  'credit_event',
  'material',
  'lab_entry',
  'queue_item',
]);

export async function deletePlatformRecord(args: JsonObject) {
  const entity = args.entity;
  const id = String(args.id ?? '').trim();
  if (!isEntity(entity) || !DELETABLE_ENTITIES.has(entity)) {
    throw new Error('This entity cannot be removed through the assistant.');
  }
  if (!id) throw new Error('A record id is required.');

  const config = ENTITY_CONFIG[entity];
  if (entity === 'queue_item') {
    const record = await deleteQueueItem(id);
    return {
      success: true,
      action: 'deleted',
      entity,
      deleted_record: record,
      note: 'The linked lab-book schedule and annexed queue files were removed too.',
    };
  }
  const supabase = getSupabaseAdminClient();
  const table = supabase.from(config.table) as any;
  const { data: record, error: loadError } = await table
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadError) throw new Error(`Unable to load ${entity}: ${loadError.message}`);
  if (!record) throw new Error(`${config.label} record not found.`);

  const { error } = await table.delete().eq('id', id);
  if (error) throw new Error(`Unable to remove ${entity}: ${error.message}`);
  if (entity === 'credit_event') {
    await rebalanceClientCreditEvents(String(record.client_id ?? ''));
  }
  if (entity === 'document') {
    await refreshClientRollup(String(record.client_id ?? ''));
  }
  return {
    success: true,
    action: 'deleted',
    entity,
    deleted_record: record,
    note:
      entity === 'client' || entity === 'document'
        ? 'The database record was removed; the source file on disk was not deleted.'
        : undefined,
  };
}

export async function setQueueItemRuns(args: JsonObject) {
  const queueItemId = String(args.queue_item_id ?? '').trim();
  if (!queueItemId) throw new Error('queue_item_id is required.');
  if (!Array.isArray(args.runs) || !args.runs.length) {
    throw new Error('runs must contain the complete desired list of one or more runs.');
  }
  const result = await updateQueueItem(queueItemId, { segments: args.runs });
  const schedule = await getQueueSchedule({ scope: 'active' });
  return {
    success: true,
    action: 'queue_runs_replaced',
    queue_item_id: queueItemId,
    run_count: Array.isArray(result.data?.segments)
      ? result.data.segments.length
      : args.runs.length,
    record: result.data,
    sync_warning: result.syncWarning,
    queue_context: {
      summary: schedule.summary,
      calendar_distribution: schedule.calendar_distribution,
      validation: schedule.validation,
    },
    note:
      'The supplied runs are now the complete run list for this queue item; omitted prior runs were removed.',
  };
}

export async function moveQueueRun(args: JsonObject) {
  const runId = String(args.run_id ?? '').trim();
  const targetRunId = String(args.target_run_id ?? '').trim();
  const placement = String(args.placement ?? 'before');
  if (!runId || !targetRunId) throw new Error('run_id and target_run_id are required.');
  if (runId === targetRunId) throw new Error('A run cannot be moved relative to itself.');
  if (!['before', 'after'].includes(placement)) {
    throw new Error('placement must be before or after.');
  }

  const ordered = (await listQueueItems())
    .flatMap((item: any) => item.segments ?? [])
    .sort(
      (left: any, right: any) =>
        Number(left.run_position) - Number(right.run_position)
    );
  const sourceIndex = ordered.findIndex((segment: any) => String(segment.id) === runId);
  if (sourceIndex < 0) throw new Error('The run_id was not found in the runway.');
  if (!ordered.some((segment: any) => String(segment.id) === targetRunId)) {
    throw new Error('The target_run_id was not found in the runway.');
  }
  const [source] = ordered.splice(sourceIndex, 1);
  const targetIndex = ordered.findIndex(
    (segment: any) => String(segment.id) === targetRunId
  );
  const insertionIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
  ordered.splice(insertionIndex, 0, source);
  await reorderQueueItems(ordered.map((segment: any) => String(segment.id)));

  const calendarReplanned = args.plan_calendar === true;
  if (calendarReplanned) await planActiveQueue();
  const schedule = await getQueueSchedule({ scope: 'active' });
  const movedRun = schedule.runs.find((run: any) => run.run_id === runId);
  return {
    success: true,
    action: 'queue_run_moved',
    run_id: runId,
    target_run_id: targetRunId,
    placement,
    new_run_position: movedRun?.run_position ?? insertionIndex + 1,
    calendar_replanned: calendarReplanned,
    queue_context: {
      summary: schedule.summary,
      calendar_distribution: schedule.calendar_distribution,
      validation: schedule.validation,
    },
  };
}

export async function moveQueueRuns(args: JsonObject) {
  if (!Array.isArray(args.moves) || !args.moves.length) {
    throw new Error('moves must contain at least one runway move.');
  }
  const moves = args.moves.map((raw, index) => {
    const move = (raw ?? {}) as JsonObject;
    const runId = String(move.run_id ?? '').trim();
    const targetRunId = String(move.target_run_id ?? '').trim();
    const placement = String(move.placement ?? 'before');
    if (!runId || !targetRunId) {
      throw new Error(`Move ${index + 1} requires run_id and target_run_id.`);
    }
    if (runId === targetRunId) {
      throw new Error(`Move ${index + 1} cannot place a run relative to itself.`);
    }
    if (!['before', 'after'].includes(placement)) {
      throw new Error(`Move ${index + 1} placement must be before or after.`);
    }
    return { runId, targetRunId, placement };
  });

  const ordered = (await listQueueItems())
    .flatMap((item: any) => item.segments ?? [])
    .sort(
      (left: any, right: any) =>
        Number(left.run_position) - Number(right.run_position)
    );
  const knownIds = new Set(ordered.map((segment: any) => String(segment.id)));
  for (const move of moves) {
    if (!knownIds.has(move.runId)) throw new Error(`Run ${move.runId} was not found.`);
    if (!knownIds.has(move.targetRunId)) {
      throw new Error(`Target run ${move.targetRunId} was not found.`);
    }
    const sourceIndex = ordered.findIndex(
      (segment: any) => String(segment.id) === move.runId
    );
    const [source] = ordered.splice(sourceIndex, 1);
    const targetIndex = ordered.findIndex(
      (segment: any) => String(segment.id) === move.targetRunId
    );
    ordered.splice(move.placement === 'after' ? targetIndex + 1 : targetIndex, 0, source);
  }

  await reorderQueueItems(ordered.map((segment: any) => String(segment.id)));
  const calendarReplanned = args.plan_calendar === true;
  if (calendarReplanned) await planActiveQueue();
  const schedule = await getQueueSchedule({ scope: 'future' });
  const positions = new Map(
    schedule.runs.map((run: any) => [String(run.run_id), Number(run.run_position)])
  );
  return {
    success: true,
    action: 'queue_runs_moved',
    moves: moves.map((move) => ({
      run_id: move.runId,
      target_run_id: move.targetRunId,
      placement: move.placement,
      new_run_position: positions.get(move.runId) ?? null,
    })),
    calendar_replanned: calendarReplanned,
    summary: schedule.summary,
    calendar_distribution: schedule.calendar_distribution,
    validation: schedule.validation,
  };
}

export async function planQueueCalendar() {
  await planActiveQueue();
  const schedule = await getQueueSchedule({ scope: 'future' });
  return {
    success: true,
    action: 'future_queue_calendar_planned',
    ...schedule,
  };
}

export async function annexDocumentToClient(args: JsonObject) {
  const clientId = String(args.client_id ?? '').trim();
  const sourcePath = String(args.source_path ?? '').trim();
  if (!clientId) throw new Error('client_id is required.');
  if (!sourcePath) throw new Error('source_path is required.');

  const supabase = getSupabaseAdminClient();
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle();
  if (clientError) throw new Error(`Unable to load client: ${clientError.message}`);
  if (!client) throw new Error('Client not found.');

  const clientiRoot = path.resolve(await resolveClientiRootPath());
  const absolutePath = path.resolve(
    path.isAbsolute(sourcePath) ? sourcePath : path.join(clientiRoot, sourcePath)
  );
  const relativeCheck = path.relative(clientiRoot, absolutePath);
  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    throw new Error('Documents must be inside the configured Clienti folder.');
  }
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats?.isFile()) throw new Error('The document file does not exist.');

  const relativePath = relativeCheck.split(path.sep).join('/');
  const extension = path.extname(absolutePath).replace(/^\./, '').toLowerCase() || 'file';
  const suppliedYear = nullableNumber(args.year);
  const inferredYear = relativePath.match(/(?:^|\/)(20\d{2})(?:\/|$)/)?.[1];
  const year = suppliedYear ?? (inferredYear ? Number(inferredYear) : null);
  const allowedCategories = new Set([
    'quote',
    'invoice',
    'payment_slip',
    'payment_receipt',
    'credit',
    'purchase_order',
    'shipping',
    'analysis',
    'other',
  ]);
  const requestedCategory = String(args.category ?? 'other');
  const category = allowedCategories.has(requestedCategory) ? requestedCategory : 'other';
  const documentsTable = supabase.from('client_documents') as any;
  const { data: existing, error: existingError } = await documentsTable
    .select('id, client_id')
    .eq('relative_path', relativePath)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Unable to inspect the document record: ${existingError.message}`);
  }

  const payload = {
    client_id: clientId,
    file_name: path.basename(absolutePath),
    relative_path: relativePath,
    absolute_path: absolutePath,
    year,
    extension,
    category,
    inferred_document_number:
      typeof args.document_number === 'string' && args.document_number.trim()
        ? args.document_number.trim()
        : null,
    inferred_document_date:
      typeof args.document_date === 'string' && args.document_date.trim()
        ? args.document_date.trim()
        : null,
    file_size_bytes: stats.size,
  };
  const result = existing
    ? await documentsTable.update(payload).eq('id', existing.id).select().single()
    : await documentsTable.insert(payload).select().single();
  if (result.error) throw new Error(`Unable to annex document: ${result.error.message}`);

  await refreshClientRollup(String(existing?.client_id ?? ''));
  await refreshClientRollup(clientId);
  return {
    success: true,
    action: existing ? 'reassigned_document' : 'annexed_document',
    client: { id: client.id, name: client.name },
    record: result.data,
  };
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
      entities: ['equipment', 'queue_item', 'lab_entry', 'backup', 'result'],
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
    if (name === 'delete_record') return await deletePlatformRecord(args);
    if (name === 'get_queue_schedule') return await getQueueSchedule(args);
    if (name === 'set_queue_item_runs') return await setQueueItemRuns(args);
    if (name === 'move_queue_run') return await moveQueueRun(args);
    if (name === 'move_queue_runs') return await moveQueueRuns(args);
    if (name === 'plan_queue_calendar') return await planQueueCalendar();
    if (name === 'annex_document_to_client') return await annexDocumentToClient(args);
    if (name === 'attach_uploaded_file_to_client') {
      return await attachAssistantUploadToClient(args);
    }
    if (name === 'import_uploaded_result_file') {
      return await importAssistantResultUpload(args);
    }
    if (name === 'adjust_material_stock') return await adjustMaterialStock(args);
    if (name === 'get_report_data') return await getReportData(args);
    if (name === 'search_gmail') {
      return await searchGmail({
        query: String(args.query ?? ''),
        maxResults: Number(args.max_results ?? 10),
      });
    }
    if (name === 'read_gmail_message') {
      return await readGmailMessage(String(args.message_id ?? ''));
    }
    if (name === 'create_gmail_draft') {
      return await createGmailDraft({
        to: Array.isArray(args.to) ? args.to.map(String) : [],
        cc: Array.isArray(args.cc) ? args.cc.map(String) : [],
        subject: String(args.subject ?? ''),
        body: String(args.body ?? ''),
      });
    }
    if (name === 'send_gmail_email') {
      return await sendGmailMessage({
        to: Array.isArray(args.to) ? args.to.map(String) : [],
        cc: Array.isArray(args.cc) ? args.cc.map(String) : [],
        subject: String(args.subject ?? ''),
        body: String(args.body ?? ''),
      });
    }
    throw new Error(`Unknown assistant tool: ${name}`);
  } catch (error) {
    return { success: false, error: readableError(error) };
  }
}
