import 'server-only';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  addQueueWorkingDays,
  brazilLabHolidayName,
  countQueueWorkingDays,
  isQueueWorkingDay,
  nextQueueWorkingDay,
  queueDateAtNineUtc,
} from '@/lib/queue/calendar';

type JsonObject = Record<string, unknown>;

type QueueSegment = {
  id: string;
  queue_item_id: string;
  segment_order: number;
  run_position: number;
  start_at: string;
  end_at: string;
  user_edited: boolean;
};

export const QUEUE_SELECT =
  'id, queue_code, queue_position, client_id, sample_label, sample_count, samples_per_week, analysis_type, matrix, priority, status, checked_in_at, estimated_start_at, estimated_end_at, actual_started_at, completed_at, asset_id, operator, attachments, notes, lab_book_entry_id, created_at, updated_at, client:clients(id, name), asset:equipment_assets(id, asset_code, name), lab_book_entry:lab_book_entries(id, title, occurred_at, next_due_at, status)';

const activeStatuses = ['queued', 'analysing'];

const queueStatuses = new Set([...activeStatuses, 'completed']);
const priorities = new Set(['routine', 'priority', 'urgent']);

export const QUEUE_WRITABLE_FIELDS = [
  'client_id',
  'sample_label',
  'sample_count',
  'samples_per_week',
  'analysis_type',
  'matrix',
  'priority',
  'status',
  'checked_in_at',
  'estimated_start_at',
  'estimated_end_at',
  'actual_started_at',
  'completed_at',
  'asset_id',
  'operator',
  'notes',
  'queue_position',
];

type QueueStatus = 'queued' | 'analysing' | 'completed';

export class QueueValidationError extends Error {}

function estimatedDurationDays(analysisType: string, sampleCount: number) {
  const throughput: Record<string, { perDay: number; setupDays: number }> = {
    'Kiel IV / MAT 253 · δ13C / δ18O carbonate': {
      perDay: 20,
      setupDays: 2,
    },
    'EA-IRMS · δ13C / δ15N': { perDay: 80, setupDays: 1 },
    'TC/EA-IRMS · δ2H / δ18O': { perDay: 50, setupDays: 1 },
    'GC-IRMS · compound specific': { perDay: 12, setupDays: 2 },
    'TOC / TN screening': { perDay: 60, setupDays: 1 },
  };
  const profile = throughput[analysisType] ?? { perDay: 40, setupDays: 1 };
  return profile.setupDays + Math.max(1, Math.ceil(sampleCount / profile.perDay));
}

function estimatedDurationFromRate(sampleCount: number, samplesPerWeek: number) {
  return Math.max(1, Math.ceil((sampleCount / samplesPerWeek) * 5));
}

function estimatedEndDate(start: Date, sampleCount: number, samplesPerWeek: number) {
  return addQueueWorkingDays(
    start,
    estimatedDurationFromRate(sampleCount, samplesPerWeek) - 1
  );
}

function sanitizePayload(body: JsonObject) {
  const payload: JsonObject = {};
  for (const field of QUEUE_WRITABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    payload[field] =
      typeof value === 'string' && value.trim() === '' ? null : value;
  }
  return payload;
}

function requiredText(value: unknown, label: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new QueueValidationError(`${label} is required.`);
  return normalized;
}

function validDate(value: unknown, label: string) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new QueueValidationError(`${label} must be a valid date.`);
  }
  return date;
}

function validSamplesPerWeek(value: unknown) {
  const throughput = Number(value);
  if (!Number.isFinite(throughput) || throughput <= 0) {
    throw new QueueValidationError(
      'samples_per_week must be a number greater than zero.'
    );
  }
  return Math.round(throughput * 100) / 100;
}

function validateEnums(payload: JsonObject) {
  if (payload.status !== undefined && !queueStatuses.has(String(payload.status))) {
    throw new QueueValidationError('Unknown queue status.');
  }
  if (payload.priority !== undefined && !priorities.has(String(payload.priority))) {
    throw new QueueValidationError('Priority must be routine, priority, or urgent.');
  }
}

function labBookStatus(status: QueueStatus) {
  return status;
}

function queueEventTitle(queueItem: any) {
  const identifiers = String(queueItem.sample_label ?? '').trim();
  const clientName = String(queueItem.client?.name ?? '').trim();
  if (!clientName || identifiers.toLocaleLowerCase() === clientName.toLocaleLowerCase()) {
    return identifiers || clientName;
  }
  return `${identifiers} - ${clientName}`;
}

function labBookPayload(queueItem: any) {
  const clientName = queueItem.client?.name;
  const detail = [
    `${queueItem.sample_count} sample${queueItem.sample_count === 1 ? '' : 's'}`,
    `${queueItem.samples_per_week} samples/week`,
    queueItem.analysis_type,
    queueItem.matrix,
    queueItem.notes,
  ].filter(Boolean);

  return {
    entry_type: 'sample_analysis',
    title: queueEventTitle(queueItem),
    occurred_at: queueItem.estimated_start_at,
    date_precision: 'estimated',
    asset_id: queueItem.asset_id,
    status: labBookStatus(queueItem.status),
    performed_by: queueItem.operator,
    description: detail.join(' · '),
    source_reference: `queue:${queueItem.id}`,
    subject: queueItem.sample_label,
    institution: clientName ?? null,
    project_reference: null,
    material: queueItem.matrix,
    quantity: queueItem.sample_count,
    next_due_at: queueItem.estimated_end_at,
  };
}

async function syncLabBook(queueItem: any) {
  const supabase = getSupabaseAdminClient();
  const payload = labBookPayload(queueItem);

  if (queueItem.lab_book_entry_id) {
    const { error } = await (supabase.from('lab_book_entries') as any)
      .update(payload)
      .eq('id', queueItem.lab_book_entry_id);
    if (error) throw error;
    return queueItem.lab_book_entry_id as string;
  }

  const { data, error } = await (supabase.from('lab_book_entries') as any)
    .insert({ ...payload, source_key: `sample-queue:${queueItem.id}` })
    .select('id')
    .single();
  if (error) throw error;

  const { error: linkError } = await (supabase.from('sample_queue_items') as any)
    .update({ lab_book_entry_id: data.id })
    .eq('id', queueItem.id);
  if (linkError) throw linkError;
  return data.id as string;
}

const SEGMENT_SELECT =
  'id, queue_item_id, segment_order, run_position, start_at, end_at, user_edited';

async function loadSegments(queueItemIds?: string[]) {
  if (queueItemIds && !queueItemIds.length) return [] as QueueSegment[];
  let query = (getSupabaseAdminClient().from('sample_queue_segments') as any)
    .select(SEGMENT_SELECT)
    .order('segment_order', { ascending: true })
    .order('run_position', { ascending: true });
  if (queueItemIds) query = query.in('queue_item_id', queueItemIds);
  const { data, error } = await query.limit(2000);
  if (error) throw error;
  return (data ?? []) as QueueSegment[];
}

function attachSegments(queueItems: any[], segments: QueueSegment[]) {
  const byItem = new Map<string, QueueSegment[]>();
  for (const segment of segments) {
    const current = byItem.get(segment.queue_item_id) ?? [];
    current.push(segment);
    byItem.set(segment.queue_item_id, current);
  }
  return queueItems.map((item) => ({
    ...item,
    segments: (byItem.get(String(item.id)) ?? []).sort(
      (left, right) => left.segment_order - right.segment_order
    ),
  }));
}

async function loadQueueItems() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await (supabase.from('sample_queue_items') as any)
    .select(QUEUE_SELECT)
    .order('queue_position', { ascending: true })
    .limit(500);
  if (error) throw error;
  const items = data ?? [];
  return attachSegments(
    items,
    await loadSegments(items.map((item: any) => String(item.id)))
  );
}

type SegmentDraft = {
  id?: string;
  start: Date;
  end: Date;
  runPosition?: number;
  userEdited?: boolean;
};

function normalizeSegmentDrafts(value: unknown, allowOverlap = false): SegmentDraft[] {
  if (!Array.isArray(value) || !value.length) {
    throw new QueueValidationError('At least one run segment is required.');
  }
  const segments = value.map((raw, index) => {
    const input = (raw ?? {}) as JsonObject;
    const start = validDate(input.start_at, `run ${index + 1} start_at`);
    const end = validDate(input.end_at, `run ${index + 1} end_at`);
    if (end < start) {
      throw new QueueValidationError(`Run ${index + 1} cannot end before it starts.`);
    }
    if (!isQueueWorkingDay(start)) {
      const holiday = brazilLabHolidayName(start);
      throw new QueueValidationError(
        `Run ${index + 1} starts on ${holiday ?? 'a weekend'}. Choose a working day.`
      );
    }
    if (!isQueueWorkingDay(end)) {
      const holiday = brazilLabHolidayName(end);
      throw new QueueValidationError(
        `Run ${index + 1} ends on ${holiday ?? 'a weekend'}. Choose a working day.`
      );
    }
    return {
      id: typeof input.id === 'string' && input.id.trim() ? input.id : undefined,
      start,
      end,
      runPosition:
        Number.isInteger(Number(input.run_position)) && Number(input.run_position) >= 0
          ? Number(input.run_position)
          : undefined,
      userEdited:
        typeof input.user_edited === 'boolean'
          ? input.user_edited
          : undefined,
    };
  });
  if (!allowOverlap) {
    segments.sort((left, right) => left.start.getTime() - right.start.getTime());
    for (let index = 1; index < segments.length; index += 1) {
      if (segments[index].start <= segments[index - 1].end) {
        throw new QueueValidationError('Run segments in the same queue item cannot overlap.');
      }
    }
  }
  return segments;
}

async function assertInstrumentAvailability(
  queueItemId: string,
  assetId: string | null,
  status: QueueStatus,
  segments: SegmentDraft[],
  ignoredSegmentIds: ReadonlySet<string> = new Set()
) {
  if (!assetId || !activeStatuses.includes(status)) return;
  const supabase = getSupabaseAdminClient();
  const { data: otherItems, error } = await (
    supabase.from('sample_queue_items') as any
  )
    .select('id, sample_label')
    .eq('asset_id', assetId)
    .in('status', activeStatuses)
    .limit(500);
  if (error) throw error;
  const others = (otherItems ?? []).filter(
    (item: any) => String(item.id) !== queueItemId
  );
  const otherSegments = await loadSegments(
    others.map((item: any) => String(item.id))
  );
  const labels = new Map(
    others.map((item: any) => [String(item.id), String(item.sample_label)])
  );
  for (const segment of segments) {
    const collision = otherSegments.find(
      (other) =>
        !ignoredSegmentIds.has(other.id) &&
        segment.start <= new Date(other.end_at) &&
        segment.end >= new Date(other.start_at)
    );
    if (collision) {
      throw new QueueValidationError(
        `This instrument is already assigned to ${
          labels.get(collision.queue_item_id) ?? 'another queue item'
        } during that run.`
      );
    }
  }
}

async function persistSegments(
  queueItemId: string,
  value: unknown,
  assetId: string | null,
  status: QueueStatus,
  ignoredSegmentIds: ReadonlySet<string> = new Set(),
  allowOverlap = false,
  userEditedSegmentId?: string
) {
  const drafts = normalizeSegmentDrafts(value, allowOverlap);
  await assertInstrumentAvailability(
    queueItemId,
    assetId,
    status,
    drafts,
    ignoredSegmentIds
  );
  const supabase = getSupabaseAdminClient();
  const existing = await loadSegments([queueItemId]);
  const existingById = new Map(existing.map((segment) => [segment.id, segment]));
  const existingIds = new Set(existing.map((segment) => segment.id));
  const keptIds = new Set(
    drafts.map((segment) => segment.id).filter((id): id is string => Boolean(id))
  );
  if (Array.from(keptIds).some((id) => !existingIds.has(id))) {
    throw new QueueValidationError('A run segment no longer belongs to this queue item.');
  }
  const maximumRunPosition = Math.max(
    0,
    ...(await loadSegments()).map((segment) => segment.run_position)
  );

  for (const segment of existing) {
    if (!keptIds.has(segment.id)) continue;
    const { error } = await (supabase.from('sample_queue_segments') as any)
      .update({ segment_order: 1000 + segment.segment_order })
      .eq('id', segment.id);
    if (error) throw error;
  }
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const payload = {
      queue_item_id: queueItemId,
      segment_order: index + 1,
      run_position: draft.runPosition ?? maximumRunPosition + index + 1,
      start_at: queueDateAtNineUtc(draft.start).toISOString(),
      end_at: queueDateAtNineUtc(draft.end).toISOString(),
      user_edited:
        draft.id === userEditedSegmentId
          ? true
          : draft.userEdited ??
            (draft.id ? existingById.get(draft.id)?.user_edited : false) ??
            false,
    };
    if (draft.id) {
      const { error } = await (supabase.from('sample_queue_segments') as any)
        .update(payload)
        .eq('id', draft.id);
      if (error) throw error;
    } else {
      const { error } = await (supabase.from('sample_queue_segments') as any)
        .insert(payload);
      if (error) throw error;
    }
  }
  for (const segment of existing) {
    if (keptIds.has(segment.id)) continue;
    const { error } = await (supabase.from('sample_queue_segments') as any)
      .delete()
      .eq('id', segment.id);
    if (error) throw error;
  }
  return loadSegments([queueItemId]);
}

async function updateQueueBounds(queueItemId: string) {
  const segments = await loadSegments([queueItemId]);
  if (!segments.length) throw new QueueValidationError('A queue item needs one run segment.');
  const start = segments.reduce(
    (earliest, segment) =>
      new Date(segment.start_at) < earliest ? new Date(segment.start_at) : earliest,
    new Date(segments[0].start_at)
  );
  const end = segments.reduce(
    (latest, segment) =>
      new Date(segment.end_at) > latest ? new Date(segment.end_at) : latest,
    new Date(segments[0].end_at)
  );
  const supabase = getSupabaseAdminClient();
  const { data, error } = await (supabase.from('sample_queue_items') as any)
    .update({
      estimated_start_at: start.toISOString(),
      estimated_end_at: end.toISOString(),
    })
    .eq('id', queueItemId)
    .select(QUEUE_SELECT)
    .single();
  if (error) throw error;
  data.segments = segments;
  return data;
}

async function renumberFutureSegmentsByDate() {
  const items = await loadQueueItems();
  const today = queueDateAtNineUtc(new Date());
  const queuePosition = new Map(
    items.map((item: any) => [String(item.id), Number(item.queue_position)])
  );
  const activeIds = new Set(
    items
      .filter((item: any) => activeStatuses.includes(String(item.status)))
      .map((item: any) => String(item.id))
  );
  const future = items
    .flatMap((item: any) => (item.segments ?? []) as QueueSegment[])
    .filter(
      (segment) =>
        activeIds.has(segment.queue_item_id) && new Date(segment.start_at) > today
    )
    .sort((left, right) => {
      const dateOrder =
        new Date(left.start_at).getTime() - new Date(right.start_at).getTime();
      if (dateOrder) return dateOrder;
      const itemOrder =
        (queuePosition.get(left.queue_item_id) ?? 0) -
        (queuePosition.get(right.queue_item_id) ?? 0);
      return itemOrder || left.segment_order - right.segment_order;
    });
  const futureIds = new Set(future.map((segment) => segment.id));
  const futurePositions = items
    .flatMap((item: any) => (item.segments ?? []) as QueueSegment[])
    .filter((segment) => futureIds.has(segment.id))
    .map((segment) => segment.run_position)
    .sort((left, right) => left - right);
  const supabase = getSupabaseAdminClient();
  for (let index = 0; index < future.length; index += 1) {
    const { error } = await (supabase.from('sample_queue_segments') as any)
      .update({ run_position: futurePositions[index] })
      .eq('id', future[index].id);
    if (error) throw error;
  }
}

type FutureCascadePlan = {
  downstreamSegmentIds: Set<string>;
};

async function prepareFutureCascade(
  anchorSegmentId: string,
  anchorStart: Date,
  anchorEnd: Date,
  originalAnchorStart: Date,
  originalAnchorEnd: Date
): Promise<FutureCascadePlan> {
  const items = await loadQueueItems();
  const activeItemIds = new Set(
    items
      .filter((item: any) => activeStatuses.includes(String(item.status)))
      .map((item: any) => String(item.id))
  );
  const runway = items
    .flatMap((item: any) => (item.segments ?? []) as QueueSegment[])
    .filter((segment) => activeItemIds.has(segment.queue_item_id))
    .sort((left, right) => {
      const runOrder = left.run_position - right.run_position;
      return runOrder || left.segment_order - right.segment_order;
    });
  const anchorIndex = runway.findIndex((segment) => segment.id === anchorSegmentId);
  if (anchorIndex === -1) {
    throw new QueueValidationError(
      'The moved queue run is no longer active. Refresh and try again.'
    );
  }

  const today = queueDateAtNineUtc(new Date());
  if (anchorEnd < anchorStart) {
    throw new QueueValidationError('The moved queue run cannot end before it starts.');
  }

  const normalizedAnchorStart = queueDateAtNineUtc(anchorStart);
  const normalizedOriginalStart = queueDateAtNineUtc(originalAnchorStart);
  const normalizedOriginalEnd = queueDateAtNineUtc(originalAnchorEnd);
  if (normalizedAnchorStart <= today) {
    const activeRunCanResizeEnd =
      normalizedOriginalStart <= today &&
      normalizedOriginalEnd >= today &&
      normalizedAnchorStart.getTime() === normalizedOriginalStart.getTime() &&
      queueDateAtNineUtc(anchorEnd) >= today;
    if (!activeRunCanResizeEnd) {
      throw new QueueValidationError(
        normalizedOriginalEnd < today
          ? 'Completed queue runs cannot be changed on the calendar.'
          : 'A queue run that has started can only resize its end date. Its start date is fixed.'
      );
    }
  }

  const latestPriorEnd = runway.slice(0, anchorIndex).reduce<Date | null>(
    (latest, segment) => {
      const end = new Date(segment.end_at);
      return !latest || end > latest ? end : latest;
    },
    null
  );
  if (latestPriorEnd && anchorStart <= latestPriorEnd) {
    throw new QueueValidationError(
      `This run must start after ${latestPriorEnd.toLocaleDateString('en-GB')}, when the preceding queue work ends.`
    );
  }
  const downstream = runway.slice(anchorIndex + 1);
  const nonFutureDownstream = downstream.find(
    (segment) => new Date(segment.start_at) <= today
  );
  if (nonFutureDownstream) {
    throw new QueueValidationError(
      'A current or past run appears later in the runway. Reorder or plan the queue before moving this run.'
    );
  }

  return {
    downstreamSegmentIds: new Set(downstream.map((segment) => segment.id)),
  };
}

function allocateDays(total: number, segments: QueueSegment[]) {
  const minimum = segments.length;
  const target = Math.max(minimum, total);
  const weights = segments.map((segment) =>
    Math.max(1, countQueueWorkingDays(new Date(segment.start_at), new Date(segment.end_at)))
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const allocation = weights.map((weight) =>
    Math.max(1, Math.floor((target * weight) / weightTotal))
  );
  let assigned = allocation.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (assigned < target) {
    allocation[index % allocation.length] += 1;
    assigned += 1;
    index += 1;
  }
  while (assigned > target) {
    const candidate = index % allocation.length;
    if (allocation[candidate] > 1) {
      allocation[candidate] -= 1;
      assigned -= 1;
    }
    index += 1;
  }
  return allocation;
}

async function rescheduleFutureSegments() {
  const items = await loadQueueItems();
  const activeItems = items.filter((item: any) =>
    activeStatuses.includes(String(item.status))
  );
  const today = queueDateAtNineUtc(new Date());
  const tomorrow = nextQueueWorkingDay(today);
  const durationBySegmentId = new Map<string, number>();

  for (const item of activeItems) {
    const segments = (item.segments ?? []) as QueueSegment[];
    const fixed = segments.filter(
      (segment) => new Date(segment.start_at) <= today || segment.user_edited
    );
    const flexible = segments.filter(
      (segment) => new Date(segment.start_at) > today && !segment.user_edited
    );
    if (!flexible.length) continue;
    const desired = estimatedDurationFromRate(
      Number(item.sample_count),
      Number(item.samples_per_week)
    );
    const fixedDays = fixed.reduce(
      (sum, segment) =>
        sum + countQueueWorkingDays(new Date(segment.start_at), new Date(segment.end_at)),
      0
    );
    const allocations = allocateDays(
      Math.max(flexible.length, desired - fixedDays),
      flexible
    );
    flexible.forEach((segment, index) =>
      durationBySegmentId.set(segment.id, allocations[index])
    );
  }

  const runway = activeItems
    .flatMap((item: any) =>
      ((item.segments ?? []) as QueueSegment[]).map((segment) => ({ item, segment }))
    )
    .sort((left, right) => {
      const runOrder = left.segment.run_position - right.segment.run_position;
      if (runOrder) return runOrder;
      const queueOrder = left.item.queue_position - right.item.queue_position;
      if (queueOrder) return queueOrder;
      return left.segment.segment_order - right.segment.segment_order;
    });

  let cursor = tomorrow;
  const firstFlexibleIndex = runway.findIndex(({ segment }) =>
    durationBySegmentId.has(segment.id)
  );
  const firstFlexible = runway[firstFlexibleIndex];
  const hasUserEditedAnchorBeforeFirst = runway
    .slice(0, Math.max(0, firstFlexibleIndex))
    .some(({ segment }) => segment.user_edited);
  if (firstFlexible && !hasUserEditedAnchorBeforeFirst) {
    const preservedFirstStart = nextQueueWorkingDay(
      new Date(firstFlexible.segment.start_at),
      true
    );
    if (preservedFirstStart > cursor) cursor = preservedFirstStart;
  }

  const planned: Array<{
    itemId: string;
    segmentId: string;
    start: Date;
    end: Date;
  }> = [];
  for (const { item, segment } of runway) {
    const originalStart = new Date(segment.start_at);
    const originalEnd = new Date(segment.end_at);
    const isFixed = originalStart <= today || segment.user_edited;
    if (isFixed) {
      if (originalStart > today && cursor > originalStart) {
        throw new QueueValidationError(
          `Fixed run ${item.queue_code} overlaps earlier runway work. Move it later or shorten the preceding run.`
        );
      }
      const afterFixed = nextQueueWorkingDay(originalEnd);
      if (afterFixed > cursor) cursor = afterFixed;
      continue;
    }

    const duration = durationBySegmentId.get(segment.id);
    if (!duration) continue;
    const start = cursor;
    const end = addQueueWorkingDays(start, duration - 1);
    planned.push({
      itemId: String(item.id),
      segmentId: segment.id,
      start,
      end,
    });
    cursor = nextQueueWorkingDay(end);
  }

  const touchedItems = new Set<string>();
  const supabase = getSupabaseAdminClient();
  for (const run of planned) {
    const { error } = await (supabase.from('sample_queue_segments') as any)
      .update({ start_at: run.start.toISOString(), end_at: run.end.toISOString() })
      .eq('id', run.segmentId);
    if (error) throw error;
    touchedItems.add(run.itemId);
  }

  let syncFailures = 0;
  for (const itemId of Array.from(touchedItems)) {
    const updated = await updateQueueBounds(itemId);
    try {
      await syncLabBook(updated);
    } catch (error) {
      console.error('Planned queue item could not sync to the lab book:', error);
      syncFailures += 1;
    }
  }
  return { count: touchedItems.size, syncFailures };
}

function queueFilesDirectory(queueId: string) {
  if (!/^[0-9a-f-]{20,}$/i.test(queueId)) return null;
  const root = process.cwd().endsWith(`${path.sep}frontend`)
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
  return path.resolve(root, '.local-data', 'queue-files', queueId);
}

export async function listQueueItems() {
  return loadQueueItems();
}

export async function createQueueItem(body: JsonObject) {
  const sampleLabel = requiredText(body.sample_label, 'sample_label');
  const analysisType = requiredText(body.analysis_type, 'analysis_type');
  const sampleCount = Number(body.sample_count);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new QueueValidationError(
      'sample_count must be a whole number greater than zero.'
    );
  }
  const samplesPerWeek = validSamplesPerWeek(body.samples_per_week ?? 100);

  const payload = sanitizePayload(body);
  validateEnums(payload);
  const supabase = getSupabaseAdminClient();
  const { data: lastItems, error: lastItemError } = await (
    supabase.from('sample_queue_items') as any
  )
    .select('queue_position')
    .order('queue_position', { ascending: false })
    .limit(1);
  if (lastItemError) throw lastItemError;

  const today = queueDateAtNineUtc(new Date());
  let calculatedStart = nextQueueWorkingDay(today, true);
  const laneItems = (await loadQueueItems()).filter(
    (item: any) =>
      activeStatuses.includes(String(item.status)) &&
      (item.asset_id ?? null) === (payload.asset_id ?? null)
  );
  for (const item of laneItems) {
    for (const segment of item.segments ?? []) {
      const afterPrevious = nextQueueWorkingDay(new Date(segment.end_at));
      if (afterPrevious > calculatedStart) calculatedStart = afterPrevious;
    }
  }

  const estimatedStart = payload.estimated_start_at
    ? validDate(payload.estimated_start_at, 'estimated_start_at')
    : calculatedStart;
  if (!isQueueWorkingDay(estimatedStart)) {
    throw new QueueValidationError('estimated_start_at must be a working day.');
  }
  const estimatedEnd = payload.estimated_end_at
    ? validDate(payload.estimated_end_at, 'estimated_end_at')
    : estimatedEndDate(estimatedStart, sampleCount, samplesPerWeek);
  if (!isQueueWorkingDay(estimatedEnd)) {
    throw new QueueValidationError('estimated_end_at must be a working day.');
  }
  if (estimatedEnd < estimatedStart) {
    throw new QueueValidationError(
      'estimated_end_at cannot be before estimated_start_at.'
    );
  }

  const requestedPosition = Number(payload.queue_position);
  const queuePosition =
    payload.queue_position !== undefined &&
    Number.isInteger(requestedPosition) &&
    requestedPosition >= 0
      ? requestedPosition
      : Number(lastItems?.[0]?.queue_position ?? 0) + 1;
  const queueCode = `Q-${today.getUTCFullYear()}-${randomUUID()
    .slice(0, 4)
    .toUpperCase()}`;

  await assertInstrumentAvailability(
    '',
    (payload.asset_id ?? null) as string | null,
    (payload.status ?? 'queued') as QueueStatus,
    [{ start: estimatedStart, end: estimatedEnd }]
  );

  if (payload.checked_in_at === null) delete payload.checked_in_at;
  const { data, error } = await (supabase.from('sample_queue_items') as any)
    .insert({
      ...payload,
      queue_code: queueCode,
      queue_position: queuePosition,
      sample_label: sampleLabel,
      sample_count: sampleCount,
      samples_per_week: samplesPerWeek,
      analysis_type: analysisType,
      priority: payload.priority ?? 'routine',
      status: payload.status ?? 'queued',
      estimated_start_at: estimatedStart.toISOString(),
      estimated_end_at: estimatedEnd.toISOString(),
      attachments: [],
    })
    .select(QUEUE_SELECT)
    .single();
  if (error) throw error;

  const { error: segmentError } = await (
    supabase.from('sample_queue_segments') as any
  ).insert({
    queue_item_id: data.id,
    segment_order: 1,
    run_position: queuePosition,
    start_at: estimatedStart.toISOString(),
    end_at: estimatedEnd.toISOString(),
  });
  if (segmentError) throw segmentError;
  data.segments = await loadSegments([String(data.id)]);

  let syncWarning: string | null = null;
  try {
    data.lab_book_entry_id = await syncLabBook(data);
  } catch (syncError) {
    console.error('Queue item saved but lab-book sync failed:', syncError);
    syncWarning = 'Saved to the queue, but the lab-book link needs to be retried.';
  }
  return { data, syncWarning };
}

export async function updateQueueItem(id: string, body: JsonObject) {
  if (!id.trim()) throw new QueueValidationError('A queue item id is required.');
  const payload = sanitizePayload(body);
  const hasSegmentInput = Array.isArray(body.segments);
  if (!Object.keys(payload).length && !hasSegmentInput) {
    throw new QueueValidationError('No writable queue fields were provided.');
  }
  validateEnums(payload);
  if (payload.sample_count !== undefined) {
    const count = Number(payload.sample_count);
    if (!Number.isInteger(count) || count < 1) {
      throw new QueueValidationError(
        'sample_count must be a whole number greater than zero.'
      );
    }
    payload.sample_count = count;
  }
  if (payload.samples_per_week !== undefined) {
    payload.samples_per_week = validSamplesPerWeek(payload.samples_per_week);
  }
  if (payload.queue_position !== undefined) {
    const position = Number(payload.queue_position);
    if (!Number.isInteger(position) || position < 0) {
      throw new QueueValidationError('queue_position must be a non-negative integer.');
    }
    payload.queue_position = position;
  }

  const supabase = getSupabaseAdminClient();
  const { data: existing, error: existingError } = await (
    supabase.from('sample_queue_items') as any
  )
    .select(
      'id, estimated_start_at, estimated_end_at, sample_count, samples_per_week, asset_id, status'
    )
    .eq('id', id)
    .single();
  if (existingError) throw existingError;
  const sampleCount = Number(payload.sample_count ?? existing.sample_count);
  const samplesPerWeek = Number(
    payload.samples_per_week ?? existing.samples_per_week
  );
  const durationParametersChanged =
    (payload.sample_count !== undefined &&
      sampleCount !== Number(existing.sample_count)) ||
    (payload.samples_per_week !== undefined &&
      samplesPerWeek !== Number(existing.samples_per_week));
  const existingSegments = await loadSegments([id]);
  let segmentInput: unknown = body.segments;
  if (!hasSegmentInput && (payload.estimated_start_at || payload.estimated_end_at)) {
    segmentInput = existingSegments.map((segment, index) => ({
      ...segment,
      start_at:
        index === 0 && payload.estimated_start_at
          ? payload.estimated_start_at
          : segment.start_at,
      end_at:
        index === existingSegments.length - 1 && payload.estimated_end_at
          ? payload.estimated_end_at
          : segment.end_at,
    }));
  }
  delete payload.estimated_start_at;
  delete payload.estimated_end_at;

  if (payload.status === 'analysing' && !('actual_started_at' in body)) {
    payload.actual_started_at = new Date().toISOString();
  }
  if (payload.status === 'completed' && !('completed_at' in body)) {
    payload.completed_at = new Date().toISOString();
  }

  const intendedAssetId = (payload.asset_id ?? existing.asset_id ?? null) as
    | string
    | null;
  const intendedStatus = (payload.status ?? existing.status) as QueueStatus;
  const cascadeRequested = body.cascade_future === true && hasSegmentInput;
  const availabilityDrafts = segmentInput
    ? normalizeSegmentDrafts(segmentInput, cascadeRequested)
    : existingSegments.map((segment) => ({
        id: segment.id,
        start: new Date(segment.start_at),
        end: new Date(segment.end_at),
        runPosition: segment.run_position,
      }));
  const originalSegmentsById = new Map(
    existingSegments.map((segment) => [segment.id, segment])
  );
  const movedFutureDrafts = cascadeRequested
    ? availabilityDrafts.filter((draft) => {
        if (!draft.id) return false;
        const original = originalSegmentsById.get(draft.id);
        if (!original) return false;
        return (
          draft.start.getTime() !== new Date(original.start_at).getTime() ||
          draft.end.getTime() !== new Date(original.end_at).getTime()
        );
      })
    : [];
  if (cascadeRequested && movedFutureDrafts.length !== 1) {
    throw new QueueValidationError(
      'Move one future queue run at a time so later runs can follow it safely.'
    );
  }
  const movedFutureDraft = movedFutureDrafts[0];
  const movedOriginal = movedFutureDraft?.id
    ? originalSegmentsById.get(movedFutureDraft.id)
    : undefined;
  const cascadePlan =
    movedFutureDraft?.id && movedOriginal
      ? await prepareFutureCascade(
          movedFutureDraft.id,
          movedFutureDraft.start,
          movedFutureDraft.end,
          new Date(movedOriginal.start_at),
          new Date(movedOriginal.end_at)
        )
      : null;
  await assertInstrumentAvailability(
    id,
    intendedAssetId,
    intendedStatus,
    availabilityDrafts,
    cascadePlan?.downstreamSegmentIds
  );

  const { data: saved, error } = Object.keys(payload).length
    ? await (supabase.from('sample_queue_items') as any)
        .update(payload)
        .eq('id', id)
        .select(QUEUE_SELECT)
        .single()
    : await (supabase.from('sample_queue_items') as any)
        .select(QUEUE_SELECT)
        .eq('id', id)
        .single();
  if (error) throw error;

  const nextAssetId = (saved.asset_id ?? null) as string | null;
  const nextStatus = saved.status as QueueStatus;
  let cascadeCount = 0;
  let syncWarning: string | null = null;
  if (segmentInput) {
    await persistSegments(
      id,
      segmentInput,
      nextAssetId,
      nextStatus,
      cascadePlan?.downstreamSegmentIds,
      Boolean(cascadePlan),
      movedFutureDraft?.id
    );
    if (cascadePlan) {
      const planned = await rescheduleFutureSegments();
      cascadeCount = planned.count;
      if (planned.syncFailures) {
        syncWarning = `${planned.syncFailures} later queue item${
          planned.syncFailures === 1 ? '' : 's'
        } need lab-book sync.`;
      }
    } else {
      await renumberFutureSegmentsByDate();
    }
  }

  let data = await updateQueueBounds(id);
  if (durationParametersChanged) {
    const planned = await rescheduleFutureSegments();
    cascadeCount = planned.count;
    if (planned.syncFailures) {
      syncWarning = `${planned.syncFailures} planned calendar item${
        planned.syncFailures === 1 ? '' : 's'
      } need lab-book sync.`;
    }
    data = (await loadQueueItems()).find((item: any) => item.id === id) ?? data;
  }
  try {
    data.lab_book_entry_id = await syncLabBook(data);
  } catch (syncError) {
    console.error('Queue item updated but lab-book sync failed:', syncError);
    syncWarning = 'Queue changes saved, but the lab-book link needs to be retried.';
  }
  return { data, syncWarning, cascadeCount };
}

export async function reorderQueueItems(orderedIds: string[]) {
  const normalizedIds = orderedIds.map((id) => String(id).trim()).filter(Boolean);
  const uniqueIds = new Set(normalizedIds);
  if (!normalizedIds.length || uniqueIds.size !== normalizedIds.length) {
    throw new QueueValidationError(
      'The complete runway order must contain each run exactly once.'
    );
  }

  const supabase = getSupabaseAdminClient();
  const existing = await loadSegments();
  const existingIds = new Set(existing.map((segment) => String(segment.id)));
  if (
    existingIds.size !== uniqueIds.size ||
    normalizedIds.some((id) => !existingIds.has(id))
  ) {
    throw new QueueValidationError(
      'The runway changed while it was being reordered. Refresh and try again.'
    );
  }

  for (let index = 0; index < normalizedIds.length; index += 1) {
    const { error } = await (supabase.from('sample_queue_segments') as any)
      .update({ run_position: index + 1 })
      .eq('id', normalizedIds[index]);
    if (error) throw error;
  }

  const orderedSegments = await loadSegments();
  const firstPositionByItem = new Map<string, number>();
  for (const segment of orderedSegments) {
    const current = firstPositionByItem.get(segment.queue_item_id);
    if (current === undefined || segment.run_position < current) {
      firstPositionByItem.set(segment.queue_item_id, segment.run_position);
    }
  }
  const orderedItems = Array.from(firstPositionByItem.entries()).sort(
    (left, right) => left[1] - right[1]
  );
  for (let index = 0; index < orderedItems.length; index += 1) {
    const { error } = await (supabase.from('sample_queue_items') as any)
      .update({ queue_position: index + 1 })
      .eq('id', orderedItems[index][0]);
    if (error) throw error;
  }

  return listQueueItems();
}

export async function planActiveQueue() {
  await rescheduleFutureSegments();
  return listQueueItems();
}

export async function deleteQueueItem(id: string) {
  if (!id.trim()) throw new QueueValidationError('A queue item id is required.');
  const supabase = getSupabaseAdminClient();
  const { data: existing, error: readError } = await (
    supabase.from('sample_queue_items') as any
  )
    .select('*')
    .eq('id', id)
    .single();
  if (readError) throw readError;

  const { error } = await (supabase.from('sample_queue_items') as any)
    .delete()
    .eq('id', id);
  if (error) throw error;
  if (existing.lab_book_entry_id) {
    const { error: labError } = await (supabase.from('lab_book_entries') as any)
      .delete()
      .eq('id', existing.lab_book_entry_id);
    if (labError) throw labError;
  }

  const filesDirectory = queueFilesDirectory(id);
  if (filesDirectory) {
    await fs.rm(filesDirectory, { recursive: true, force: true });
  }
  return existing;
}
