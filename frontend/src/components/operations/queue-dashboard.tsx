'use client';
import { postUploadForm } from '@/lib/cloud/upload-client';

import {
  Fragment,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  FileSpreadsheet,
  FlaskConical,
  GripVertical,
  ListFilter,
  Loader2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Scissors,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import {
  PageHeader,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { labBookEntryColorClass } from '@/lib/lab-book/entry-colors';
import { queueRunDateBlockReason } from '@/lib/queue/reschedule';
import {
  addQueueWorkingDays,
  brazilLabHolidayName,
  countQueueWorkingDays,
  isQueueWorkingDay,
  nextQueueWorkingDay,
} from '@/lib/queue/calendar';
import {
  createResource,
  fetchResource,
  selectClassName,
  textareaClassName,
  updateResource,
} from '@/lib/operations/client';
import { cn } from '@/lib/utils';

type QueueStatus = 'queued' | 'analysing' | 'completed';
type QueuePriority = 'routine' | 'priority' | 'urgent';

type Client = { id: string; name: string };
type Asset = { id: string; asset_code: string; name: string };
type QueueAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  uploaded_at: string;
};
type QueueSegment = {
  id: string;
  queue_item_id: string;
  segment_order: number;
  run_position: number;
  start_at: string;
  end_at: string;
  user_edited: boolean;
};
type QueueSegmentDraft = {
  id?: string;
  runPosition?: number;
  start: string;
  end: string;
  userEdited?: boolean;
};
type QueueItem = {
  id: string;
  queue_code: string;
  queue_position: number;
  client_id: string | null;
  sample_label: string;
  sample_count: number;
  samples_per_week: number;
  analysis_type: string;
  matrix: string | null;
  priority: QueuePriority;
  status: QueueStatus;
  checked_in_at: string;
  estimated_start_at: string;
  estimated_end_at: string;
  actual_started_at: string | null;
  completed_at: string | null;
  asset_id: string | null;
  operator: string | null;
  attachments: QueueAttachment[] | string | null;
  notes: string | null;
  lab_book_entry_id: string | null;
  client: Client | null;
  asset: Asset | null;
  segments: QueueSegment[];
};
type RunwayRow = {
  id: string;
  item: QueueItem;
  segment: QueueSegment;
  runNumber: number;
  runCount: number;
};
type LabEntry = {
  id: string;
  source_key: string | null;
  entry_type: string;
  title: string;
  occurred_at: string;
  next_due_at: string | null;
  status:
    | QueueStatus
    | 'scheduled'
    | 'in_progress'
    | 'failed'
    | 'cancelled';
  description: string | null;
  asset_id: string | null;
  performed_by: string | null;
  project_reference: string | null;
  asset: Asset | null;
};

type LabEntryType =
  | 'publication'
  | 'masters_delivery'
  | 'phd_delivery'
  | 'results_delivery'
  | 'maintenance'
  | 'calibration'
  | 'incident'
  | 'quality_control'
  | 'software'
  | 'infrastructure'
  | 'sample_analysis'
  | 'general';

type CalendarEvent =
  | {
      id: string;
      kind: 'queue';
      title: string;
      subtitle: string;
      start: Date;
      end: Date;
      status: QueueStatus;
      queue: QueueItem;
      queueSegment: QueueSegment;
    }
  | {
      id: string;
      kind: 'lab-book';
      title: string;
      subtitle: string;
      start: Date;
      end: Date;
      status: LabEntry['status'];
      labEntry: LabEntry;
    };

type CalendarDragMode = 'move' | 'resize-start' | 'resize-end';

type CalendarDragInteraction = {
  event: CalendarEvent;
  mode: CalendarDragMode;
  pointerId: number;
  anchor: Date;
  originalStart: Date;
  originalEnd: Date;
  previewStart: Date;
  previewEnd: Date;
  originX: number;
  originY: number;
  hasMoved: boolean;
};

type CalendarHoverCard = {
  event: CalendarEvent;
  left: number;
  top: number;
};

type CalendarRunContextMenu = {
  event: Extract<CalendarEvent, { kind: 'queue' }>;
  day: Date;
  left: number;
  top: number;
};

const analysisTypes = [
  'Kiel IV / MAT 253 · δ13C / δ18O carbonate',
  'EA-IRMS · δ13C / δ15N',
  'TC/EA-IRMS · δ2H / δ18O',
  'GC-IRMS · compound specific',
  'TOC / TN screening',
];

const activeQueueStatuses: QueueStatus[] = ['queued', 'analysing'];

const queueStatusLabels: Record<QueueStatus, string> = {
  queued: 'Queued',
  analysing: 'Analysing',
  completed: 'Completed',
};

const queueStages: QueueStatus[] = ['queued', 'analysing', 'completed'];

const labEntryTypes: Array<{ value: LabEntryType; label: string }> = [
  { value: 'general', label: 'General note' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'incident', label: 'Technical issue' },
  { value: 'quality_control', label: 'Quality control' },
  { value: 'sample_analysis', label: 'Sample analysis' },
  { value: 'results_delivery', label: 'Results delivery' },
  { value: 'software', label: 'Software' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'publication', label: 'Publication' },
  { value: 'masters_delivery', label: 'MSc delivery' },
  { value: 'phd_delivery', label: 'PhD delivery' },
];

function normalizeAttachments(value: QueueItem['attachments']) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as QueueAttachment[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function representedDispatchIds(notes: string | null) {
  const marker = 'Result dispatch IDs:';
  const markerIndex = notes?.indexOf(marker) ?? -1;
  if (!notes || markerIndex === -1) return [];
  return (
    notes
      .slice(markerIndex + marker.length)
      .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []
  );
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'The operation could not be completed.');
  return payload;
}

async function fetchQueue(): Promise<QueueItem[]> {
  const response = await fetch('/api/queue', { cache: 'no-store' });
  const payload = await readJson(response);
  return payload.data ?? [];
}

function dateInputValue(value: string | null | undefined) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function dateInputToIso(value: string) {
  return value ? new Date(`${value}T09:00:00.000Z`).toISOString() : null;
}

function localDateTimeInput() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function formatDay(value: string | Date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(value));
}

function formatFullDay(value: string | Date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: QueueStatus | LabEntry['status']) {
  if (status === 'completed') return 'success' as const;
  if (['analysing', 'in_progress'].includes(status)) return 'primary' as const;
  if (['queued', 'scheduled'].includes(status)) return 'warning' as const;
  if (['cancelled', 'failed'].includes(status)) return 'danger' as const;
  return 'neutral' as const;
}

function beginningOfCalendar(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return first;
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addCalendarDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function calendarDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function queueHolidayForCalendarDay(value: Date) {
  return brazilLabHolidayName(
    new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 9))
  );
}

function queueDateForCalendarDay(value: Date) {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 9));
}

function calendarDayForQueueDate(value: Date) {
  return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12);
}

function isQueueCalendarWorkingDay(value: Date) {
  return isQueueWorkingDay(queueDateForCalendarDay(value));
}

function previousQueueCalendarWorkingDay(value: Date, includeCurrent = false) {
  const result = startOfDay(value);
  if (!includeCurrent) result.setDate(result.getDate() - 1);
  while (!isQueueCalendarWorkingDay(result)) result.setDate(result.getDate() - 1);
  return result;
}

function shiftQueueCalendarWorkingDays(value: Date, offset: number) {
  const queueDate = queueDateForCalendarDay(value);
  if (offset >= 0) {
    return calendarDayForQueueDate(addQueueWorkingDays(queueDate, offset));
  }
  const result = startOfDay(value);
  let remaining = Math.abs(Math.ceil(offset));
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    if (isQueueCalendarWorkingDay(result)) remaining -= 1;
  }
  return result;
}

function queueWorkingDayOffset(start: Date, end: Date) {
  if (isSameDay(start, end)) return 0;
  const direction = end > start ? 1 : -1;
  const cursor = startOfDay(start);
  let offset = 0;
  while (!isSameDay(cursor, end)) {
    cursor.setDate(cursor.getDate() + direction);
    if (isQueueCalendarWorkingDay(cursor)) offset += direction;
  }
  return offset;
}

function calendarEventOccursOnDay(event: CalendarEvent, day: Date) {
  const value = startOfDay(day);
  return (
    startOfDay(event.start) <= value &&
    startOfDay(event.end) >= value &&
    (event.kind === 'lab-book' || isQueueCalendarWorkingDay(value))
  );
}

function calendarDateFromPoint(clientX: number, clientY: number) {
  if (typeof document === 'undefined') return null;
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const element of elements) {
    const datedElement = element.closest<HTMLElement>('[data-calendar-date]');
    const dateValue = datedElement?.dataset.calendarDate;
    if (dateValue) return new Date(`${dateValue}T12:00:00`);
  }
  for (const element of elements) {
    const weekElement = element.closest<HTMLElement>('[data-calendar-week-start]');
    const weekValue = weekElement?.dataset.calendarWeekStart;
    if (!weekElement || !weekValue) continue;
    const bounds = weekElement.getBoundingClientRect();
    if (!bounds.width) continue;
    const column = Math.max(
      0,
      Math.min(6, Math.floor(((clientX - bounds.left) / bounds.width) * 7))
    );
    return addCalendarDays(new Date(`${weekValue}T12:00:00`), column);
  }
  return null;
}

function daysBetween(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function orderedDateRange(first: Date, second: Date) {
  const left = startOfDay(first);
  const right = startOfDay(second);
  return left <= right ? { start: left, end: right } : { start: right, end: left };
}

function dateWithinRange(day: Date, first: Date, second: Date) {
  const range = orderedDateRange(first, second);
  const value = startOfDay(day);
  return value >= range.start && value <= range.end;
}

type WeekEventSegment = {
  event: CalendarEvent;
  segmentStart: Date;
  segmentEnd: Date;
  column: number;
  span: number;
  track: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

function layoutEventRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  gridStart = rangeStart
) {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  const grid = startOfDay(gridStart);
  const segments: Array<Omit<WeekEventSegment, 'track'>> = events
    .filter((event) => startOfDay(event.start) <= end && startOfDay(event.end) >= start)
    .flatMap((event): Array<Omit<WeekEventSegment, 'track'>> => {
      const eventStart = startOfDay(event.start);
      const eventEnd = startOfDay(event.end);
      const visibleStart = eventStart < start ? start : eventStart;
      const visibleEnd = eventEnd > end ? end : eventEnd;
      if (event.kind === 'lab-book') {
        return [{
          event,
          segmentStart: visibleStart,
          segmentEnd: visibleEnd,
          column: daysBetween(grid, visibleStart) + 1,
          span: daysBetween(visibleStart, visibleEnd) + 1,
          continuesBefore: eventStart < start,
          continuesAfter: eventEnd > end,
        }];
      }

      const workingRanges: Array<{ start: Date; end: Date }> = [];
      const cursor = startOfDay(visibleStart);
      while (cursor <= visibleEnd) {
        if (!isQueueCalendarWorkingDay(cursor)) {
          cursor.setDate(cursor.getDate() + 1);
          continue;
        }
        const rangeStart = new Date(cursor);
        let rangeEnd = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        while (cursor <= visibleEnd && isQueueCalendarWorkingDay(cursor)) {
          rangeEnd = new Date(cursor);
          cursor.setDate(cursor.getDate() + 1);
        }
        workingRanges.push({ start: rangeStart, end: rangeEnd });
      }

      return workingRanges.map((workingRange) => ({
        event,
        segmentStart: workingRange.start,
        segmentEnd: workingRange.end,
        column: daysBetween(grid, workingRange.start) + 1,
        span: daysBetween(workingRange.start, workingRange.end) + 1,
        continuesBefore: eventStart < workingRange.start,
        continuesAfter: eventEnd > workingRange.end,
      }));
    })
    .sort((a, b) => {
      const startDifference = a.segmentStart.getTime() - b.segmentStart.getTime();
      if (startDifference) return startDifference;
      return b.span - a.span;
    });

  const trackEnds: Date[] = [];
  return segments.map<WeekEventSegment>((segment) => {
    let track = trackEnds.findIndex((end) => end < segment.segmentStart);
    if (track === -1) track = trackEnds.length;
    trackEnds[track] = segment.segmentEnd;
    return { ...segment, track };
  });
}

function layoutWeekEvents(events: CalendarEvent[], weekStart: Date) {
  const start = startOfDay(weekStart);
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return layoutEventRange(events, start, weekEnd);
}

function layoutYearWeekEvents(
  events: CalendarEvent[],
  weekStart: Date,
  month: Date
) {
  const gridStart = startOfDay(weekStart);
  const weekEnd = new Date(gridStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const visibleStart = gridStart < monthStart ? monthStart : gridStart;
  const visibleEnd = weekEnd > monthEnd ? monthEnd : weekEnd;
  if (visibleStart > visibleEnd) return [];
  return layoutEventRange(events, visibleStart, visibleEnd, gridStart);
}

function compactEventColorClass(event: CalendarEvent) {
  if (event.kind === 'lab-book') {
    return labBookEntryColorClass(event.labEntry.entry_type);
  }
  if (event.status === 'completed') return 'bg-blue-500 dark:bg-blue-600';
  if (event.status === 'analysing') return 'bg-indigo-700 dark:bg-indigo-600';
  return 'bg-sky-500 dark:bg-sky-600';
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function calendarDragBlockReason(
  event: CalendarEvent,
  mode: CalendarDragMode
) {
  if (event.kind !== 'queue') return null;
  return queueRunDateBlockReason(
    event.status, startOfDay(event.start), startOfDay(event.end), mode, startOfDay(new Date())
  );
}

function calendarSplitBlockReason(event: CalendarEvent, splitDay: Date) {
  if (event.kind !== 'queue') return 'Only queue runs can be split.';
  const today = startOfDay(new Date());
  const eventStart = startOfDay(event.start);
  const eventEnd = startOfDay(event.end);
  const day = startOfDay(splitDay);
  if (event.status === 'completed' || eventEnd < today) {
    return 'Completed queue runs cannot be split.';
  }
  if (!isQueueCalendarWorkingDay(day)) {
    return 'Choose a working day to split this run.';
  }
  if (day <= eventStart) {
    return 'Choose a day after this run starts.';
  }
  if (day > eventEnd) {
    return 'Choose a day within this run.';
  }
  if (eventStart <= today) {
    const lastElapsedWorkingDay = isQueueCalendarWorkingDay(today)
      ? today
      : previousQueueCalendarWorkingDay(today, true);
    const firstRunEnd = previousQueueCalendarWorkingDay(day);
    if (firstRunEnd < lastElapsedWorkingDay) {
      return 'Choose the next working day or a later date.';
    }
  }
  return null;
}

function blankQueueDraft() {
  return {
    clientId: '',
    sampleLabel: '',
    sampleCount: '1',
    samplesPerWeek: '100',
    analysisType: analysisTypes[0],
    matrix: '',
    priority: 'routine' as QueuePriority,
    status: 'queued' as QueueStatus,
    checkedInAt: localDateTimeInput(),
    estimatedStart: '',
    estimatedEnd: '',
    assetId: '',
    operator: '',
    notes: '',
    segments: [] as QueueSegmentDraft[],
  };
}

function blankLabDraft() {
  return {
    entryType: 'general' as LabEntryType,
    title: '',
    start: '',
    end: '',
    status: 'queued' as LabEntry['status'],
    assetId: '',
    performedBy: '',
    description: '',
  };
}

export function QueueDashboard() {
  const queryClient = useQueryClient();
  const dragAnchorRef = useRef<Date | null>(null);
  const calendarDragRef = useRef<CalendarDragInteraction | null>(null);
  const calendarContextMenuRef = useRef<HTMLDivElement | null>(null);
  const suppressCalendarClickRef = useRef(false);
  const runwayScrollRef = useRef<HTMLDivElement | null>(null);
  const nextQueueItemRef = useRef<HTMLElement | null>(null);
  const runwayAlignmentKeyRef = useRef('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | QueueStatus>('all');
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)
  );
  const [calendarView, setCalendarView] = useState<'month' | 'year'>('year');
  const [queueEditorOpen, setQueueEditorOpen] = useState(false);
  const [labEditorOpen, setLabEditorOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<QueueItem | null>(null);
  const [editingLab, setEditingLab] = useState<LabEntry | null>(null);
  const [queueDraft, setQueueDraft] = useState(blankQueueDraft);
  const [labDraft, setLabDraft] = useState(blankLabDraft);
  const [dragSelection, setDragSelection] = useState<{
    anchor: Date;
    focus: Date;
  } | null>(null);
  const [calendarDrag, setCalendarDrag] =
    useState<CalendarDragInteraction | null>(null);
  const [calendarHover, setCalendarHover] = useState<CalendarHoverCard | null>(
    null
  );
  const [calendarContextMenu, setCalendarContextMenu] =
    useState<CalendarRunContextMenu | null>(null);
  const [draggedQueueId, setDraggedQueueId] = useState<string | null>(null);
  const [dragOverQueueId, setDragOverQueueId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [message, setMessage] = useState('');

  const queueQuery = useQuery({
    queryKey: ['sample-queue'],
    queryFn: fetchQueue,
    retry: false,
  });
  const clientsQuery = useQuery({
    queryKey: ['operations', 'clients'],
    queryFn: () => fetchResource<Client>('clients'),
    retry: false,
  });
  const assetsQuery = useQuery({
    queryKey: ['operations', 'assets'],
    queryFn: () => fetchResource<Asset>('assets'),
    retry: false,
  });
  const labBookQuery = useQuery({
    queryKey: ['operations', 'lab-book'],
    queryFn: () => fetchResource<LabEntry>('lab-book'),
    retry: false,
  });

  const invalidateSchedule = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sample-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'lab-book'] }),
      queryClient.invalidateQueries({ queryKey: ['operations-header-summary'] }),
    ]);
  };

  const saveQueueMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: queueDraft.clientId || null,
        sample_label: queueDraft.sampleLabel.trim(),
        sample_count: Number(queueDraft.sampleCount),
        samples_per_week: Number(queueDraft.samplesPerWeek),
        analysis_type: queueDraft.analysisType,
        matrix: queueDraft.matrix.trim() || null,
        priority: queueDraft.priority,
        checked_in_at: new Date(queueDraft.checkedInAt).toISOString(),
        asset_id: queueDraft.assetId || null,
        operator: queueDraft.operator.trim() || null,
        notes: queueDraft.notes.trim() || null,
        segments: editingQueue
          ? queueDraft.segments.map((segment) => ({
              id: segment.id,
              run_position: segment.runPosition,
              start_at: dateInputToIso(segment.start),
              end_at: dateInputToIso(segment.end),
              user_edited: segment.userEdited,
            }))
          : undefined,
        ...(editingQueue
          ? {
              status: queueDraft.status,
              estimated_start_at: dateInputToIso(queueDraft.estimatedStart),
              estimated_end_at: dateInputToIso(queueDraft.estimatedEnd),
            }
          : {}),
      };
      const response = await fetch(
        editingQueue ? `/api/queue?id=${encodeURIComponent(editingQueue.id)}` : '/api/queue',
        {
          method: editingQueue ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const result = await readJson(response);
      const queueId = result.data.id as string;
      for (const file of pendingFiles) {
        const formData = new FormData();
        formData.append('file', file);
        const uploadResponse = await postUploadForm(`/api/queue/${queueId}/files`, formData);
        await readJson(uploadResponse);
      }
      return result;
    },
    onSuccess: async (result) => {
      const estimate = result.data?.estimated_start_at
        ? ` Analysis window: ${formatDay(result.data.estimated_start_at)}–${formatDay(
            result.data.estimated_end_at
          )}.`
        : '';
      const cascade = result.cascadeCount
        ? ` ${result.cascadeCount} later queue event${
            result.cascadeCount === 1 ? '' : 's'
          } recalculated.`
        : '';
      setMessage(
        `${editingQueue ? 'Queue item updated.' : 'Samples checked in.'}${estimate}${cascade}${
          result.syncWarning ? ` ${result.syncWarning}` : ''
        }`
      );
      setQueueEditorOpen(false);
      setEditingQueue(null);
      setPendingFiles([]);
      await invalidateSchedule();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const quickStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: QueueStatus }) => {
      const response = await fetch(`/api/queue?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      return readJson(response);
    },
    onSuccess: async () => {
      setMessage('Queue status updated and synced to the lab book.');
      await invalidateSchedule();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const reorderQueueMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const response = await fetch('/api/queue/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ordered_ids: orderedIds }),
      });
      return readJson(response);
    },
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ['sample-queue'] });
      const previous = queryClient.getQueryData<QueueItem[]>(['sample-queue']);
      if (previous) {
        const positions = new Map(
          orderedIds.map((segmentId, index) => [segmentId, index + 1])
        );
        queryClient.setQueryData<QueueItem[]>(
          ['sample-queue'],
          previous
            .map((item) => {
              const segments = item.segments.map((segment) => ({
                ...segment,
                run_position: positions.get(segment.id) ?? segment.run_position,
              }));
              return {
                ...item,
                queue_position: Math.min(
                  ...segments.map((segment) => segment.run_position)
                ),
                segments,
              };
            })
            .sort((left, right) => left.queue_position - right.queue_position)
        );
      }
      return { previous };
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['sample-queue'], result.data ?? []);
      setMessage('Runway order saved. Select Plan on calendar to apply it to future dates.');
      await invalidateSchedule();
    },
    onError: (error: Error, _orderedIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['sample-queue'], context.previous);
      }
      setMessage(error.message);
    },
    onSettled: () => {
      setDraggedQueueId(null);
      setDragOverQueueId(null);
      void queryClient.invalidateQueries({ queryKey: ['sample-queue'] });
    },
  });

  const planQueueMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/queue/plan', { method: 'POST' });
      return readJson(response);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['sample-queue'], result.data ?? []);
      setMessage(
        'Future runs were placed in runway order using working-day durations and skipping weekends and São Paulo/Brazil holidays.'
      );
      await invalidateSchedule();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const calendarDateMutation = useMutation({
    mutationFn: async ({
      event,
      start,
      end,
    }: {
      event: CalendarEvent;
      start: Date;
      end: Date;
    }) => {
      const startIso = dateInputToIso(calendarDateKey(start));
      const endIso = dateInputToIso(calendarDateKey(end));
      if (event.kind === 'queue') {
        const segments = event.queue.segments.map((segment) =>
          segment.id === event.queueSegment.id
            ? {
                ...segment,
                start_at: startIso,
                end_at: endIso,
                user_edited: true,
              }
            : segment
        );
        const response = await fetch(
          `/api/queue?id=${encodeURIComponent(event.queue.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              segments,
              cascade_future: true,
            }),
          }
        );
        return readJson(response);
      }
      await updateResource('lab-book', event.labEntry.id, {
        occurred_at: startIso,
        next_due_at: endIso,
      });
      return { syncWarning: null };
    },
    onMutate: async ({ event, start, end }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['sample-queue'] }),
        queryClient.cancelQueries({ queryKey: ['operations', 'lab-book'] }),
      ]);
      const previousQueue = queryClient.getQueryData<QueueItem[]>(['sample-queue']);
      const previousLab = queryClient.getQueryData<LabEntry[]>([
        'operations',
        'lab-book',
      ]);
      const startIso = dateInputToIso(calendarDateKey(start)) as string;
      const endIso = dateInputToIso(calendarDateKey(end)) as string;
      if (event.kind === 'queue') {
        queryClient.setQueryData<QueueItem[]>(
          ['sample-queue'],
          (current = []) =>
            current.map((item) =>
              item.id === event.queue.id
                ? {
                    ...item,
                    estimated_start_at:
                      item.segments.length === 1
                        ? startIso
                        : item.estimated_start_at,
                    estimated_end_at:
                      item.segments.length === 1 ? endIso : item.estimated_end_at,
                    segments: item.segments.map((segment) =>
                      segment.id === event.queueSegment.id
                        ? {
                            ...segment,
                            start_at: startIso,
                            end_at: endIso,
                            user_edited: true,
                          }
                        : segment
                    ),
                  }
                : item
            )
        );
      } else {
        queryClient.setQueryData<LabEntry[]>(
          ['operations', 'lab-book'],
          (current = []) =>
            current.map((entry) =>
              entry.id === event.labEntry.id
                ? { ...entry, occurred_at: startIso, next_due_at: endIso }
                : entry
            )
        );
      }
      return { previousQueue, previousLab };
    },
    onSuccess: (result, { event, start, end }) => {
      const cascade = result.cascadeCount
        ? ` ${result.cascadeCount} later run${
            result.cascadeCount === 1 ? '' : 's'
          } shifted to keep the runway clear.`
        : '';
      setMessage(
        event.kind === 'queue'
          ? `Queue analysis window fixed at ${formatDay(start)}–${formatDay(
              end
            )}.${cascade}${result.syncWarning ? ` ${result.syncWarning}` : ''}`
          : `Lab-book item moved to ${formatDay(start)}–${formatDay(end)}.${
              result.syncWarning ? ` ${result.syncWarning}` : ''
            }`
      );
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousQueue) {
        queryClient.setQueryData(['sample-queue'], context.previousQueue);
      }
      if (context?.previousLab) {
        queryClient.setQueryData(['operations', 'lab-book'], context.previousLab);
      }
      setMessage(error.message);
    },
    onSettled: () => invalidateSchedule(),
  });

  const splitCalendarRunMutation = useMutation({
    mutationFn: async ({
      event,
      splitDay,
    }: {
      event: Extract<CalendarEvent, { kind: 'queue' }>;
      splitDay: Date;
    }) => {
      const firstRunEnd = previousQueueCalendarWorkingDay(splitDay);
      const firstRunEndIso = dateInputToIso(calendarDateKey(firstRunEnd));
      const secondRunStartIso = dateInputToIso(calendarDateKey(splitDay));
      const sourceSegments = event.queue.segments.length
        ? event.queue.segments
        : [event.queueSegment];
      const segments = sourceSegments.flatMap((segment) => {
        if (segment.id !== event.queueSegment.id) return [segment];
        return [
          {
            ...segment,
            id: segment.id.startsWith('legacy-') ? undefined : segment.id,
            start_at: segment.start_at,
            end_at: firstRunEndIso,
            user_edited: true,
          },
          {
            queue_item_id: event.queue.id,
            start_at: secondRunStartIso,
            end_at: segment.end_at,
            user_edited: true,
          },
        ];
      });
      const response = await fetch(
        `/api/queue?id=${encodeURIComponent(event.queue.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments }),
        }
      );
      return readJson(response);
    },
    onMutate: () => {
      setCalendarContextMenu(null);
      setCalendarHover(null);
      setMessage('Splitting queue run...');
    },
    onSuccess: (result, { splitDay }) => {
      setMessage(
        `Run split. The new run starts ${formatFullDay(splitDay)}.${
          result.syncWarning ? ` ${result.syncWarning}` : ''
        }`
      );
    },
    onError: (error: Error) => setMessage(error.message),
    onSettled: () => void invalidateSchedule(),
  });

  const saveLabMutation = useMutation({
    mutationFn: () => {
      const payload = {
        entry_type: labDraft.entryType,
        title: labDraft.title.trim(),
        occurred_at: dateInputToIso(labDraft.start),
        next_due_at: dateInputToIso(labDraft.end),
        status: labDraft.status,
        asset_id: labDraft.assetId || null,
        performed_by: labDraft.performedBy.trim() || null,
        description: labDraft.description.trim() || null,
      };
      return editingLab
        ? updateResource('lab-book', editingLab.id, payload)
        : createResource('lab-book', payload);
    },
    onSuccess: async () => {
      setMessage(
        editingLab
          ? 'Lab-book calendar item updated.'
          : 'Lab-book calendar item added.'
      );
      setLabEditorOpen(false);
      setEditingLab(null);
      await invalidateSchedule();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const labBookEntries = useMemo(() => labBookQuery.data ?? [], [labBookQuery.data]);
  const linkedLabIds = useMemo(
    () => new Set(queue.map((item) => item.lab_book_entry_id).filter(Boolean)),
    [queue]
  );
  const representedLabDispatchIds = useMemo(
    () =>
      new Set(
        queue.flatMap((item) => representedDispatchIds(item.notes))
      ),
    [queue]
  );

  const filteredQueue = useMemo(() => {
    const query = search.trim().toLowerCase();
    return queue.filter((item) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active'
          ? activeQueueStatuses.includes(item.status)
          : item.status === statusFilter);
      const haystack = [
        item.queue_code,
        item.sample_label,
        item.client?.name,
        item.analysis_type,
        item.matrix,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [queue, search, statusFilter]);

  const runwayRows = useMemo<RunwayRow[]>(
    () =>
      filteredQueue
        .flatMap((item) => {
          const segments = [...(item.segments ?? [])].sort(
            (left, right) => left.segment_order - right.segment_order
          );
          return segments.map((segment, index) => ({
            id: segment.id,
            item,
            segment,
            runNumber: index + 1,
            runCount: segments.length,
          }));
        })
        .sort((left, right) => {
          const runOrder = left.segment.run_position - right.segment.run_position;
          if (runOrder) return runOrder;
          return left.item.queue_position - right.item.queue_position;
        }),
    [filteredQueue]
  );

  const nextFutureRunwayId = useMemo(() => {
    const today = startOfDay(new Date());
    return (
      runwayRows.find(
        (row) =>
          activeQueueStatuses.includes(row.item.status) &&
          startOfDay(new Date(row.segment.end_at)) >= today
      )?.id ?? null
    );
  }, [runwayRows]);

  const hasPlannableFutureRuns = useMemo(() => {
    const today = startOfDay(new Date());
    return queue.some(
      (item) =>
        activeQueueStatuses.includes(item.status) &&
        (item.segments ?? []).some(
          (segment) => startOfDay(new Date(segment.start_at)) > today
        )
    );
  }, [queue]);

  useEffect(() => {
    const alignmentKey = `${calendarView}:${statusFilter}:${search}:${nextFutureRunwayId ?? ''}`;
    if (
      runwayAlignmentKeyRef.current === alignmentKey ||
      queueQuery.isPending ||
      !nextFutureRunwayId ||
      !runwayScrollRef.current ||
      !nextQueueItemRef.current
    ) {
      return;
    }
    const container = runwayScrollRef.current;
    const target = nextQueueItemRef.current;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        runwayAlignmentKeyRef.current = alignmentKey;
        container.scrollTop = Math.max(
          0,
          target.offsetTop - 8
        );
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [calendarView, nextFutureRunwayId, queueQuery.isPending, search, statusFilter]);

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const queueEvents: CalendarEvent[] = queue.flatMap((item) => {
        const clientName = item.client?.name?.trim();
        const identifiers = item.sample_label.trim();
        const identity =
          !clientName || identifiers.toLocaleLowerCase() === clientName.toLocaleLowerCase()
            ? identifiers || clientName || 'Sample group'
            : `${identifiers} - ${clientName}`;
        const segments = item.segments?.length
          ? item.segments
          : [
              {
                id: `legacy-${item.id}`,
                queue_item_id: item.id,
                segment_order: 1,
                run_position: item.queue_position,
                start_at: item.estimated_start_at,
                end_at: item.estimated_end_at,
                user_edited: false,
              },
            ];
        return segments.map((segment) => ({
          id: `queue-${item.id}-${segment.id}`,
          kind: 'queue' as const,
          title: identity,
          subtitle: `${item.sample_count} samples · ${item.samples_per_week} samples/week · run ${segment.segment_order}/${segments.length} · ${item.analysis_type.split(' · ')[0]}`,
          start: new Date(segment.start_at),
          end: new Date(segment.end_at),
          status: item.status,
          queue: item,
          queueSegment: segment,
        }));
    });
    const labEvents: CalendarEvent[] = labBookEntries
      .filter(
        (entry) =>
          entry.status !== 'cancelled' &&
          !linkedLabIds.has(entry.id) &&
          !representedLabDispatchIds.has(entry.id) &&
          !entry.source_key?.startsWith('sample-queue:')
      )
      .map((entry) => ({
        id: `lab-${entry.id}`,
        kind: 'lab-book' as const,
        title: entry.title,
        subtitle: entry.asset?.asset_code ?? entry.entry_type.replace(/_/g, ' '),
        start: new Date(entry.occurred_at),
        end: new Date(entry.next_due_at ?? entry.occurred_at),
        status: entry.status,
        labEntry: entry,
      }));
    return [...queueEvents, ...labEvents].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
  }, [queue, labBookEntries, linkedLabIds, representedLabDispatchIds]);

  const displayedCalendarEvents = useMemo(
    () =>
      calendarDrag
        ? calendarEvents.map((event) =>
            event.id === calendarDrag.event.id
              ? {
                  ...event,
                  start: calendarDrag.previewStart,
                  end: calendarDrag.previewEnd,
                }
              : event
          )
        : calendarEvents,
    [calendarDrag, calendarEvents]
  );

  const calendarDays = useMemo(() => {
    const first = beginningOfCalendar(calendarMonth);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(first);
      day.setDate(first.getDate() + index);
      return day;
    });
  }, [calendarMonth]);

  const calendarWeeks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, weekIndex) =>
        calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)
      ),
    [calendarDays]
  );

  const yearMonths = useMemo(
    () =>
      Array.from({ length: 24 }, (_, monthIndex) => {
        const month = new Date(calendarMonth.getFullYear(), monthIndex, 1, 12);
        const first = beginningOfCalendar(month);
        const days = Array.from({ length: 42 }, (_value, dayIndex) => {
          const day = new Date(first);
          day.setDate(first.getDate() + dayIndex);
          return day;
        });
        const weeks = Array.from({ length: 6 }, (_value, weekIndex) =>
          days.slice(weekIndex * 7, weekIndex * 7 + 7)
        ).filter((week) =>
          week.some((day) => day.getMonth() === month.getMonth())
        );
        return { month, weeks };
      }),
    [calendarMonth]
  );

  const canReorderQueue =
    statusFilter === 'all' &&
    !search.trim() &&
    runwayRows.length > 1 &&
    !reorderQueueMutation.isPending &&
    !planQueueMutation.isPending;

  function openNewQueue() {
    setEditingQueue(null);
    setQueueDraft(blankQueueDraft());
    setPendingFiles([]);
    setMessage('');
    setQueueEditorOpen(true);
  }

  function openQueue(item: QueueItem) {
    setEditingQueue(item);
    setQueueDraft({
      clientId: item.client_id ?? '',
      sampleLabel: item.sample_label,
      sampleCount: String(item.sample_count),
      samplesPerWeek: String(item.samples_per_week),
      analysisType: item.analysis_type,
      matrix: item.matrix ?? '',
      priority: item.priority,
      status: item.status,
      checkedInAt: (() => {
        const date = new Date(item.checked_in_at);
        const offset = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
      })(),
      estimatedStart: dateInputValue(item.estimated_start_at),
      estimatedEnd: dateInputValue(item.estimated_end_at),
      assetId: item.asset_id ?? '',
      operator: item.operator ?? '',
      notes: item.notes ?? '',
      segments: (item.segments?.length
        ? item.segments
        : [
            {
              id: `legacy-${item.id}`,
              run_position: item.queue_position,
              start_at: item.estimated_start_at,
              end_at: item.estimated_end_at,
              user_edited: false,
            },
          ]
      ).map((segment) => ({
        id: segment.id.startsWith('legacy-') ? undefined : segment.id,
        runPosition: segment.run_position,
        start: dateInputValue(segment.start_at),
        end: dateInputValue(segment.end_at),
        userEdited: segment.user_edited,
      })),
    });
    setPendingFiles([]);
    setMessage('');
    setQueueEditorOpen(true);
  }

  function splitQueueRun(index: number) {
    setQueueDraft((draft) => {
      const segment = draft.segments[index];
      if (!segment) return draft;
      const start = new Date(`${segment.start}T09:00:00.000Z`);
      const end = new Date(`${segment.end}T09:00:00.000Z`);
      const workingDays = countQueueWorkingDays(start, end);
      if (workingDays < 2) {
        setMessage('A one-day run cannot be split. Extend it first.');
        return draft;
      }
      const firstDays = Math.ceil(workingDays / 2);
      const firstEnd = addQueueWorkingDays(start, firstDays - 1);
      const secondStart = nextQueueWorkingDay(firstEnd);
      const nextSegments = [...draft.segments];
      nextSegments.splice(
        index,
        1,
        {
          ...segment,
          end: dateInputValue(firstEnd.toISOString()),
        },
        {
          start: dateInputValue(secondStart.toISOString()),
          end: segment.end,
        }
      );
      return { ...draft, segments: nextSegments };
    });
  }

  function removeQueueRun(index: number) {
    setQueueDraft((draft) =>
      draft.segments.length <= 1
        ? draft
        : {
            ...draft,
            segments: draft.segments.filter((_segment, runIndex) => runIndex !== index),
          }
    );
  }

  function openLabEntry(entry: LabEntry) {
    setEditingLab(entry);
    setLabDraft({
      entryType: entry.entry_type as LabEntryType,
      title: entry.title,
      start: dateInputValue(entry.occurred_at),
      end: dateInputValue(entry.next_due_at ?? entry.occurred_at),
      status:
        entry.status === 'scheduled'
          ? 'queued'
          : entry.status === 'in_progress'
            ? 'analysing'
            : entry.status,
      assetId: entry.asset_id ?? entry.asset?.id ?? '',
      performedBy: entry.performed_by ?? '',
      description: entry.description ?? '',
    });
    setMessage('');
    setLabEditorOpen(true);
  }

  function openNewLabRange(first: Date, second: Date) {
    const range = orderedDateRange(first, second);
    setEditingLab(null);
    setLabDraft({
      ...blankLabDraft(),
      start: dateInputValue(range.start.toISOString()),
      end: dateInputValue(range.end.toISOString()),
    });
    dragAnchorRef.current = null;
    setDragSelection(null);
    setMessage('');
    setLabEditorOpen(true);
  }

  function beginDateSelection(day: Date) {
    dragAnchorRef.current = day;
    setDragSelection({ anchor: day, focus: day });
  }

  function extendDateSelection(day: Date) {
    setDragSelection((current) =>
      current ? { ...current, focus: day } : current
    );
  }

  function finishDateSelection(day: Date) {
    const anchor = dragAnchorRef.current;
    if (!anchor) return;
    openNewLabRange(anchor, day);
  }

  function cancelDateSelection() {
    dragAnchorRef.current = null;
    setDragSelection(null);
  }

  const mutateQueueOrder = reorderQueueMutation.mutate;
  const persistDisplayedQueueOrder = useCallback((reorderedRows: RunwayRow[]) => {
    mutateQueueOrder(reorderedRows.map((row) => row.segment.id));
  }, [mutateQueueOrder]);

  const reorderDisplayedQueue = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const next = [...runwayRows];
    const draggedIndex = next.findIndex((row) => row.id === draggedId);
    const targetIndex = next.findIndex((row) => row.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;
    const [dragged] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, dragged);
    persistDisplayedQueueOrder(next);
  }, [persistDisplayedQueueOrder, runwayRows]);

  function moveQueueItem(itemId: string, offset: -1 | 1) {
    const currentIndex = runwayRows.findIndex((row) => row.id === itemId);
    const targetIndex = currentIndex + offset;
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= runwayRows.length) {
      return;
    }
    const next = [...runwayRows];
    const [item] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, item);
    persistDisplayedQueueOrder(next);
  }

  useEffect(() => {
    if (!canReorderQueue || !draggedQueueId) return;
    const sourceId = draggedQueueId;

    function runwayIdAtPoint(clientX: number, clientY: number) {
      const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      return element?.closest<HTMLElement>('[data-runway-id]')?.dataset.runwayId ?? null;
    }

    function handlePointerMove(event: PointerEvent) {
      if ((event.buttons & 1) === 0) return;
      setDragOverQueueId(runwayIdAtPoint(event.clientX, event.clientY));

      const runway = runwayScrollRef.current;
      if (!runway) return;
      const bounds = runway.getBoundingClientRect();
      const edgeSize = 48;
      if (event.clientY < bounds.top + edgeSize) runway.scrollBy({ top: -18 });
      if (event.clientY > bounds.bottom - edgeSize) runway.scrollBy({ top: 18 });
    }

    function handlePointerUp(event: PointerEvent) {
      const targetId = runwayIdAtPoint(event.clientX, event.clientY);
      if (targetId && targetId !== sourceId) {
        reorderDisplayedQueue(sourceId, targetId);
      }
      setDraggedQueueId(null);
      setDragOverQueueId(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    window.addEventListener('pointercancel', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [canReorderQueue, draggedQueueId, reorderDisplayedQueue]);

  function openCalendarEvent(event: CalendarEvent) {
    if (event.kind === 'queue') openQueue(event.queue);
    else openLabEntry(event.labEntry);
  }

  function openCalendarRunContextMenu(
    item: CalendarEvent,
    mouseEvent: ReactMouseEvent<HTMLElement>
  ) {
    if (item.kind !== 'queue') return;
    if (calendarDateMutation.isPending || splitCalendarRunMutation.isPending) {
      return;
    }
    const day = calendarDateFromPoint(mouseEvent.clientX, mouseEvent.clientY);
    if (!day || !calendarEventOccursOnDay(item, day)) return;
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    const menuWidth = 232;
    const menuHeight = 164;
    const gutter = 8;
    setCalendarHover(null);
    cancelDateSelection();
    setCalendarContextMenu({
      event: item,
      day,
      left: Math.max(
        gutter,
        Math.min(mouseEvent.clientX, window.innerWidth - menuWidth - gutter)
      ),
      top: Math.max(
        gutter,
        Math.min(mouseEvent.clientY, window.innerHeight - menuHeight - gutter)
      ),
    });
  }

  function splitCalendarRun() {
    if (!calendarContextMenu) return;
    const blockReason = calendarSplitBlockReason(
      calendarContextMenu.event,
      calendarContextMenu.day
    );
    if (blockReason) {
      setMessage(blockReason);
      return;
    }
    splitCalendarRunMutation.mutate({
      event: calendarContextMenu.event,
      splitDay: calendarContextMenu.day,
    });
  }

  function setCalendarDragInteraction(
    interaction: CalendarDragInteraction | null
  ) {
    calendarDragRef.current = interaction;
    setCalendarDrag(interaction);
  }

  function previewCalendarDrag(
    interaction: CalendarDragInteraction,
    target: Date,
    clientX: number,
    clientY: number
  ) {
    let previewStart = interaction.originalStart;
    let previewEnd = interaction.originalEnd;
    if (interaction.event.kind === 'queue' && interaction.mode === 'move') {
      const duration = Math.max(
        1,
        countQueueWorkingDays(
          queueDateForCalendarDay(interaction.originalStart),
          queueDateForCalendarDay(interaction.originalEnd)
        )
      );
      const offset = queueWorkingDayOffset(interaction.anchor, target);
      previewStart = shiftQueueCalendarWorkingDays(interaction.originalStart, offset);
      previewEnd = shiftQueueCalendarWorkingDays(previewStart, duration - 1);
    } else if (interaction.event.kind === 'queue' && interaction.mode === 'resize-start') {
      const workingTarget = isQueueCalendarWorkingDay(target)
        ? target
        : calendarDayForQueueDate(
            nextQueueWorkingDay(queueDateForCalendarDay(target), true)
          );
      previewStart =
        workingTarget > interaction.originalEnd ? interaction.originalEnd : workingTarget;
    } else if (interaction.event.kind === 'queue') {
      const workingTarget = isQueueCalendarWorkingDay(target)
        ? target
        : previousQueueCalendarWorkingDay(target, true);
      const today = startOfDay(new Date());
      const minimumEnd =
        interaction.event.status === 'analysing' && interaction.originalStart <= today
          ? isQueueCalendarWorkingDay(today)
            ? today
            : calendarDayForQueueDate(
                nextQueueWorkingDay(queueDateForCalendarDay(today), true)
              )
          : interaction.originalStart;
      previewEnd =
        workingTarget < minimumEnd ? minimumEnd : workingTarget;
    } else if (interaction.mode === 'move') {
      const offset = daysBetween(interaction.anchor, target);
      previewStart = addCalendarDays(interaction.originalStart, offset);
      previewEnd = addCalendarDays(interaction.originalEnd, offset);
    } else if (interaction.mode === 'resize-start') {
      previewStart = target > interaction.originalEnd ? interaction.originalEnd : target;
    } else {
      previewEnd = target < interaction.originalStart ? interaction.originalStart : target;
    }
    const pointerDistance = Math.hypot(
      clientX - interaction.originX,
      clientY - interaction.originY
    );
    return {
      ...interaction,
      previewStart,
      previewEnd,
      hasMoved:
        interaction.hasMoved ||
        pointerDistance > 4 ||
        !isSameDay(previewStart, interaction.originalStart) ||
        !isSameDay(previewEnd, interaction.originalEnd),
    };
  }

  function showCalendarEventHover(
    item: CalendarEvent,
    pointerEvent: ReactPointerEvent<HTMLElement>
  ) {
    if (pointerEvent.pointerType === 'touch' || calendarDragRef.current) return;
    const cardWidth = 288;
    const cardHeight = 112;
    const gap = 14;
    const left = Math.max(
      12,
      Math.min(pointerEvent.clientX + gap, window.innerWidth - cardWidth - 12)
    );
    const top =
      pointerEvent.clientY + gap + cardHeight > window.innerHeight
        ? Math.max(12, pointerEvent.clientY - cardHeight - gap)
        : pointerEvent.clientY + gap;
    setCalendarHover({ event: item, left, top });
  }

  function hideCalendarEventHover(itemId: string) {
    setCalendarHover((current) =>
      current?.event.id === itemId ? null : current
    );
  }

  function beginCalendarEventDrag(
    item: CalendarEvent,
    mode: CalendarDragMode,
    pointerEvent: ReactPointerEvent<HTMLElement>
  ) {
    if (
      pointerEvent.button !== 0 ||
      calendarDateMutation.isPending ||
      splitCalendarRunMutation.isPending
    ) {
      return;
    }
    const blockReason = calendarDragBlockReason(item, mode);
    if (blockReason) {
      setMessage(blockReason);
      return;
    }
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    setCalendarHover(null);
    cancelDateSelection();
    const originalStart = startOfDay(item.start);
    const originalEnd = startOfDay(item.end);
    const fallback = mode === 'resize-end' ? originalEnd : originalStart;
    const anchor =
      calendarDateFromPoint(pointerEvent.clientX, pointerEvent.clientY) ?? fallback;
    setCalendarDragInteraction({
      event: item,
      mode,
      pointerId: pointerEvent.pointerId,
      anchor,
      originalStart,
      originalEnd,
      previewStart: originalStart,
      previewEnd: originalEnd,
      originX: pointerEvent.clientX,
      originY: pointerEvent.clientY,
      hasMoved: false,
    });
  }

  function updateCalendarEventDrag(
    pointerId: number,
    clientX: number,
    clientY: number
  ) {
    const interaction = calendarDragRef.current;
    if (!interaction || pointerId !== interaction.pointerId) return;
    const target = calendarDateFromPoint(clientX, clientY);
    if (!target) return;
    setCalendarDragInteraction(
      previewCalendarDrag(
        interaction,
        target,
        clientX,
        clientY
      )
    );
  }

  function finishCalendarEventDrag(
    pointerId: number,
    clientX: number,
    clientY: number
  ) {
    const interaction = calendarDragRef.current;
    if (!interaction || pointerId !== interaction.pointerId) return;
    const target = calendarDateFromPoint(clientX, clientY);
    const finalInteraction = target
      ? previewCalendarDrag(
          interaction,
          target,
          clientX,
          clientY
        )
      : interaction;
    setCalendarDragInteraction(null);
    if (!finalInteraction.hasMoved) return;
    suppressCalendarClickRef.current = true;
    window.setTimeout(() => {
      suppressCalendarClickRef.current = false;
    }, 0);
    if (
      isSameDay(finalInteraction.previewStart, finalInteraction.originalStart) &&
      isSameDay(finalInteraction.previewEnd, finalInteraction.originalEnd)
    ) {
      return;
    }
    calendarDateMutation.mutate({
      event: finalInteraction.event,
      start: finalInteraction.previewStart,
      end: finalInteraction.previewEnd,
    });
  }

  function cancelCalendarEventDrag(pointerId?: number) {
    const interaction = calendarDragRef.current;
    if (!interaction || (pointerId !== undefined && pointerId !== interaction.pointerId)) {
      return;
    }
    setCalendarDragInteraction(null);
    suppressCalendarClickRef.current = interaction.hasMoved;
    window.setTimeout(() => {
      suppressCalendarClickRef.current = false;
    }, 0);
  }

  useEffect(() => {
    if (!calendarDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== calendarDragRef.current?.pointerId) return;
      event.preventDefault();
      updateCalendarEventDrag(event.pointerId, event.clientX, event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      finishCalendarEventDrag(event.pointerId, event.clientX, event.clientY);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      cancelCalendarEventDrag(event.pointerId);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelCalendarEventDrag();
    };
    const handleWindowBlur = () => cancelCalendarEventDrag();

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [calendarDrag?.event.id, calendarDrag?.pointerId]);

  useEffect(() => {
    if (!calendarContextMenu) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const action = calendarContextMenuRef.current?.querySelector<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      );
      (action ?? calendarContextMenuRef.current)?.focus();
    });
    const closeMenu = () => setCalendarContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !calendarContextMenuRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [calendarContextMenu]);

  function handleCalendarEventClick(event: CalendarEvent) {
    if (suppressCalendarClickRef.current) return;
    setCalendarHover(null);
    openCalendarEvent(event);
  }

  function saveQueue(event: FormEvent) {
    event.preventDefault();
    saveQueueMutation.mutate();
  }

  function saveLab(event: FormEvent) {
    event.preventDefault();
    saveLabMutation.mutate();
  }

  async function removeAttachment(attachment: QueueAttachment) {
    if (!editingQueue) return;
    if (!window.confirm(`Remove “${attachment.name}” from this queue item?`)) return;
    try {
      const response = await fetch(
        `/api/queue/${editingQueue.id}/files?attachment=${encodeURIComponent(attachment.id)}`,
        { method: 'DELETE' }
      );
      await readJson(response);
      setEditingQueue((current) =>
        current
          ? {
              ...current,
              attachments: normalizeAttachments(current.attachments).filter(
                (item) => item.id !== attachment.id
              ),
            }
          : null
      );
      setMessage('Annexed file removed.');
      await queryClient.invalidateQueries({ queryKey: ['sample-queue'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'File could not be removed.');
    }
  }

  return (
    <div className="space-y-workspace">
      <PageHeader
        eyebrow="Laboratory operations / live schedule"
        title="Sample queue"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void invalidateSchedule()}
              disabled={queueQuery.isFetching}
            >
              <RefreshCw
                className={cn('mr-2 h-3.5 w-3.5', queueQuery.isFetching && 'animate-spin')}
              />
              Refresh
            </Button>
            <Button onClick={openNewQueue}>
              <Plus className="mr-2 h-4 w-4" /> Check in samples
            </Button>
          </>
        }
      />

      {message ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-100"
          aria-live="polite"
        >
          <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage('')}
            className="ml-auto rounded p-0.5 hover:bg-blue-100 dark:hover:bg-blue-900"
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Dismiss message</span>
          </button>
        </div>
      ) : null}

      <div className="grid gap-workspace xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.8fr)]">
        <section
          className={cn(
            'overflow-hidden rounded-lg border bg-card shadow-sm',
            calendarView === 'year' && 'xl:flex xl:min-h-0 xl:flex-col'
          )}
        >
          <div className="border-b p-panel">
            <div className="flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold">Queue runway</h2>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {filteredQueue.length} batches · {runwayRows.length} runs
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => planQueueMutation.mutate()}
              disabled={
                planQueueMutation.isPending ||
                reorderQueueMutation.isPending ||
                !hasPlannableFutureRuns
              }
              title="Recalculate future runs only, skipping instrument conflicts, weekends, and lab holidays"
            >
              {planQueueMutation.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CalendarDays className="mr-2 h-3.5 w-3.5" />
              )}
              Plan on calendar
            </Button>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_132px] xl:grid-cols-1 min-[1750px]:grid-cols-[1fr_132px]">
              <label className="relative">
                <span className="sr-only">Search queue</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search batch or client"
                  className="pl-8"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
                className={selectClassName}
                aria-label="Filter queue status"
              >
                <option value="active">Active queue</option>
                <option value="all">All runway · past + future</option>
                {Object.entries(queueStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
              <GripVertical className="h-3 w-3" />
              {canReorderQueue
                ? 'Drag any run to reorder · split runs can be interleaved'
                : 'Show all runway items and clear search to reorder runs'}
            </p>
          </div>

          {queueQuery.isPending ? (
            <div className="grid min-h-32 place-items-center text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading queue
              </span>
            </div>
          ) : queueQuery.isError ? (
            <div className="p-6 text-center text-xs text-destructive">
              The sample queue could not be loaded.
            </div>
          ) : runwayRows.length ? (
            <div
              ref={runwayScrollRef}
              className={cn(
                'relative overflow-y-auto px-3 py-2',
                calendarView === 'year'
                  ? 'max-h-[720px] xl:h-0 xl:max-h-none xl:min-h-0 xl:flex-1'
                  : 'max-h-[720px]'
              )}
            >
              {runwayRows.map((row, index) => {
                const { item, segment, runNumber, runCount } = row;
                const stage = queueStages.indexOf(item.status);
                const expectedWorkingDays = countQueueWorkingDays(
                  new Date(segment.start_at),
                  new Date(segment.end_at)
                );
                const isPast =
                  startOfDay(new Date(segment.end_at)) < startOfDay(new Date());
                const isNextFuture = row.id === nextFutureRunwayId;
                return (
                  <article
                    key={row.id}
                    data-runway-id={row.id}
                    ref={isNextFuture ? nextQueueItemRef : undefined}
                    className={cn(
                      'relative flex gap-2 rounded-lg pb-1.5 transition-[opacity,background-color,box-shadow]',
                      isPast && 'opacity-70 grayscale-[0.2]',
                      isNextFuture &&
                        'bg-blue-50/70 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.22)] dark:bg-blue-950/20',
                      draggedQueueId === row.id && 'opacity-40',
                      dragOverQueueId === row.id &&
                        draggedQueueId !== row.id &&
                        'bg-blue-50 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)] dark:bg-blue-950/30'
                    )}
                  >
                    <div className="relative flex w-7 shrink-0 justify-center">
                      {index < runwayRows.length - 1 ? (
                        <span className="absolute bottom-[-8px] top-6 w-px bg-blue-200 dark:bg-blue-900" />
                      ) : null}
                      <button
                        type="button"
                        onPointerDown={(event) => {
                          if (!canReorderQueue || event.button !== 0) return;
                          event.preventDefault();
                          setDraggedQueueId(row.id);
                          setDragOverQueueId(row.id);
                        }}
                        onKeyDown={(event) => {
                          if (!canReorderQueue) return;
                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveQueueItem(row.id, -1);
                          }
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            moveQueueItem(row.id, 1);
                          }
                        }}
                        aria-label={`Reorder ${item.queue_code}, run ${runNumber} of ${runCount}, position ${index + 1}`}
                        title={
                          canReorderQueue
                            ? 'Drag to reorder, or use the up and down arrow keys'
                            : 'Clear search and show all runway items to reorder'
                        }
                        className={cn(
                          'relative mt-4 grid h-6 w-6 place-items-center rounded-full border-2 bg-card font-mono text-[9px] font-semibold',
                          canReorderQueue &&
                            'touch-none cursor-grab hover:scale-105 hover:shadow-sm active:cursor-grabbing',
                          item.status === 'analysing'
                            ? 'border-blue-500 text-blue-700 dark:text-blue-300'
                            : item.status === 'completed'
                              ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-300 text-muted-foreground dark:border-slate-700'
                        )}
                      >
                        {index + 1}
                      </button>
                    </div>
                    <div className="min-w-0 flex-1 rounded-lg border bg-background/60 transition-shadow hover:shadow-sm">
                      <button
                        type="button"
                        onClick={() => openQueue(item)}
                        className="w-full text-left"
                      >
                        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                          <p className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
                              {item.queue_code}
                              {runCount > 1 ? ` · Run ${runNumber}/${runCount}` : ''}
                          </p>
                          <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
                          <h3
                            className="flex min-w-0 flex-1 items-center gap-1.5 font-display text-[13px] font-semibold leading-4"
                            title={item.client?.name ?? item.sample_label}
                          >
                            <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate">
                              {item.client?.name ?? item.sample_label}
                            </span>
                          </h3>
                          <StatusPill tone={statusTone(item.status)}>
                            {queueStatusLabels[item.status]}
                          </StatusPill>
                        </div>
                        <div className="flex min-w-0 items-center gap-2 border-t border-blue-100 bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
                          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="shrink-0 font-semibold">
                            Expected{' '}
                            <strong className="font-mono text-[12px] font-bold tabular-nums text-primary dark:text-blue-300">
                              {expectedWorkingDays} {expectedWorkingDays === 1 ? 'workday' : 'workdays'}
                            </strong>
                          </span>
                          <span className="min-w-0 truncate font-mono font-semibold tabular-nums text-blue-800 dark:text-blue-200">
                            {formatDay(segment.start_at)} → {formatDay(segment.end_at)}
                          </span>
                          {segment.user_edited ? (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                              title="Dates fixed by a calendar edit; planning will preserve this run"
                            >
                              <Lock className="h-2.5 w-2.5" /> Fixed
                            </span>
                          ) : null}
                          {runCount > 1 ? (
                            <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                              Split batch
                            </span>
                          ) : null}
                          {isPast ? (
                            <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              Past
                            </span>
                          ) : isNextFuture ? (
                            <span className="shrink-0 rounded bg-blue-700 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-white">
                              Next
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <div className="flex min-w-0 items-center gap-2 border-t px-3 py-1.5">
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                          title={`${item.client ? item.sample_label : 'Internal laboratory'} · ${item.sample_count} samples · ${item.samples_per_week} samples/week · ${item.analysis_type}`}
                        >
                          {item.client ? item.sample_label : 'Internal laboratory'} ·{' '}
                          {item.sample_count} samples · {item.samples_per_week}/week ·{' '}
                          {item.analysis_type}
                        </span>
                        <div className="grid w-12 shrink-0 grid-cols-3 gap-1" aria-hidden="true">
                          {queueStages.map((status, stageIndex) => (
                            <span
                              key={status}
                              className={cn(
                                'h-1 rounded-full',
                                stageIndex <= stage && stage >= 0
                                  ? item.status === 'completed'
                                    ? 'bg-emerald-500'
                                    : 'bg-blue-500'
                                  : 'bg-slate-200 dark:bg-slate-800'
                              )}
                            />
                          ))}
                        </div>
                        {normalizeAttachments(item.attachments).length ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                            <Paperclip className="h-3 w-3" />
                            {normalizeAttachments(item.attachments).length}
                          </span>
                        ) : null}
                        {!isPast && activeQueueStatuses.includes(item.status) ? (
                          <button
                            type="button"
                            onClick={() => openQueue(item)}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                            aria-label={`Edit or split ${item.queue_code}`}
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        ) : null}
                        <select
                          value={item.status}
                          onChange={(event) =>
                            quickStatusMutation.mutate({
                              id: item.id,
                              status: event.target.value as QueueStatus,
                            })
                          }
                          className="h-7 max-w-24 shrink-0 rounded-md border bg-background px-1.5 text-[11px]"
                          aria-label={`Update ${item.queue_code} status`}
                        >
                          {Object.entries(queueStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </article>
                );
              })}
              {calendarView === 'year' ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-full hidden h-[720px] w-px 2xl:block"
                />
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center px-6 text-center">
              <div>
                <FlaskConical className="mx-auto h-6 w-6 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold">No queue items here</h3>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Check in a sample batch or change the current filters.
                </p>
                <Button className="mt-4" size="sm" onClick={openNewQueue}>
                  Check in samples
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b p-panel">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold">Analysis calendar</h2>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Drag empty dates to add. Drag a bar to move it, or its edge grips to resize.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1 md:ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="mr-1"
                onClick={() => openNewLabRange(new Date(), new Date())}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add event
              </Button>
              <div className="mr-1 inline-flex h-8 items-center rounded-md border bg-slate-50 p-0.5 dark:bg-slate-900">
                {(['month', 'year'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setCalendarView(view)}
                    className={cn(
                      'h-7 rounded px-2 text-[11px] font-semibold capitalize text-muted-foreground',
                      calendarView === view &&
                        'bg-background text-foreground shadow-sm'
                    )}
                  >
                    {view}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setCalendarMonth(
                    calendarView === 'month'
                      ? new Date(
                          calendarMonth.getFullYear(),
                          calendarMonth.getMonth() - 1,
                          1,
                          12
                        )
                      : new Date(calendarMonth.getFullYear() - 1, 0, 1, 12)
                  )
                }
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous month</span>
              </Button>
              <button
                type="button"
                onClick={() =>
                  setCalendarMonth(
                    new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12)
                  )
                }
                className="min-w-36 rounded-md px-3 py-1.5 text-center font-display text-sm font-semibold hover:bg-muted"
              >
                {calendarView === 'month'
                  ? new Intl.DateTimeFormat('en-GB', {
                      month: 'long',
                      year: 'numeric',
                    }).format(calendarMonth)
                  : `${calendarMonth.getFullYear()}–${
                      calendarMonth.getFullYear() + 1
                    }`}
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setCalendarMonth(
                    calendarView === 'month'
                      ? new Date(
                          calendarMonth.getFullYear(),
                          calendarMonth.getMonth() + 1,
                          1,
                          12
                        )
                      : new Date(calendarMonth.getFullYear() + 1, 0, 1, 12)
                  )
                }
              >
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next month</span>
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {calendarView === 'month' ? (
                <>
                  <div className="grid grid-cols-7 border-b bg-slate-50 dark:bg-slate-900/70">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div
                    key={day}
                    className="border-r px-2 py-2 text-center font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground last:border-r-0"
                  >
                    {day}
                  </div>
                ))}
                  </div>
                  <div
                    className="select-none"
                    onPointerCancel={cancelDateSelection}
                    onPointerLeave={cancelDateSelection}
                  >
                {calendarWeeks.map((week, weekIndex) => {
                  const segments = layoutWeekEvents(displayedCalendarEvents, week[0]);
                  const maximumTrack = segments.reduce(
                    (maximum, segment) => Math.max(maximum, segment.track),
                    -1
                  );
                  const weekHeight = Math.max(88, 40 + (maximumTrack + 1) * 24);
                  return (
                    <div
                      key={week[0].toISOString()}
                      data-calendar-week-start={calendarDateKey(week[0])}
                      className="relative border-b last:border-b-0"
                      style={{ minHeight: `${weekHeight}px` }}
                    >
                      <div className="absolute inset-0 grid grid-cols-7">
                        {week.map((day) => {
                          const eventsOnDay = displayedCalendarEvents.filter(
                            (event) => calendarEventOccursOnDay(event, day)
                          ).length;
                          const today = isSameDay(day, new Date());
                          const holiday = queueHolidayForCalendarDay(day);
                          const weekend = day.getDay() === 0 || day.getDay() === 6;
                          const selected = dragSelection
                            ? dateWithinRange(
                                day,
                                dragSelection.anchor,
                                dragSelection.focus
                              )
                            : false;
                          return (
                            <button
                              key={day.toISOString()}
                              type="button"
                              data-calendar-date={calendarDateKey(day)}
                              aria-current={today ? 'date' : undefined}
                              aria-label={`Add lab-book event on ${new Intl.DateTimeFormat(
                                'en-GB',
                                { dateStyle: 'full' }
                              ).format(day)}${holiday ? ` · ${holiday}` : weekend ? ' · weekend' : ''}`}
                              onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                event.preventDefault();
                                beginDateSelection(day);
                              }}
                              onPointerEnter={(event) => {
                                if (dragSelection && event.buttons === 1) {
                                  extendDateSelection(day);
                                }
                              }}
                              onPointerUp={(event) => {
                                if (!dragSelection) return;
                                event.preventDefault();
                                finishDateSelection(day);
                              }}
                              onClick={(event) => {
                                if (event.detail === 0) openNewLabRange(day, day);
                              }}
                              className={cn(
                                'group relative border-r text-left last:border-r-0 focus-visible:z-20',
                                day.getMonth() !== calendarMonth.getMonth() &&
                                  'bg-slate-50/70 text-muted-foreground dark:bg-slate-950/35',
                                day.getMonth() === calendarMonth.getMonth() &&
                                  (weekend || holiday) &&
                                  'bg-slate-100/65 dark:bg-slate-900/55',
                                today &&
                                  'z-10 bg-blue-50 ring-2 ring-inset ring-blue-600 dark:bg-blue-950/45 dark:ring-blue-400',
                                selected &&
                                  'bg-violet-100/80 ring-1 ring-inset ring-violet-400 dark:bg-violet-950/55'
                              )}
                            >
                              <span className="absolute left-1.5 right-1.5 top-1.5 flex h-6 items-center justify-between">
                                <span
                                  className={cn(
                                    'grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-[11px] tabular-nums',
                                    today &&
                                      'h-7 min-w-7 bg-blue-700 font-bold text-white shadow-[0_2px_5px_rgba(29,78,216,0.35)] ring-2 ring-white dark:bg-blue-500 dark:ring-slate-950'
                                  )}
                                >
                                  {day.getDate()}
                                </span>
                                {eventsOnDay ? (
                                  <span className="font-mono text-[9px] text-muted-foreground">
                                    {eventsOnDay}
                                  </span>
                                ) : (
                                  <Plus className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div
                        className="pointer-events-none absolute inset-x-0 top-9 grid grid-cols-7 gap-y-1 px-1"
                        style={{ gridAutoRows: '20px' }}
                      >
                        {segments.map((segment) => (
                          <div
                            key={`${segment.event.id}-${weekIndex}-${segment.column}-${segment.span}`}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(event) =>
                              beginCalendarEventDrag(segment.event, 'move', event)
                            }
                            onContextMenu={(event) =>
                              openCalendarRunContextMenu(segment.event, event)
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCalendarEventClick(segment.event);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openCalendarEvent(segment.event);
                              }
                            }}
                            title={`${segment.event.title} · ${formatDay(
                              segment.event.start
                            )}–${formatDay(segment.event.end)}`}
                            className={cn(
                              'relative z-10 min-w-0 touch-none select-none truncate border px-2 text-left text-[9px] font-semibold leading-[18px] shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:brightness-95 focus-visible:z-30',
                              dragSelection
                                ? 'pointer-events-none'
                                : cn(
                                    'pointer-events-auto',
                                    calendarDragBlockReason(segment.event, 'move')
                                      ? 'cursor-pointer'
                                      : 'cursor-grab active:cursor-grabbing'
                                  ),
                              calendarDrag?.event.id === segment.event.id &&
                                'z-20 brightness-95 ring-2 ring-white/80 shadow-md dark:ring-slate-950/80',
                              segment.event.kind === 'queue'
                                ? segment.event.status === 'completed'
                                  ? 'border-blue-300 bg-blue-100 text-blue-900 dark:border-blue-800 dark:bg-blue-900 dark:text-blue-100'
                                  : segment.event.status === 'analysing'
                                    ? 'border-indigo-400 bg-indigo-700 text-white dark:border-indigo-500 dark:bg-indigo-700'
                                    : 'border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-800 dark:bg-sky-900 dark:text-sky-100'
                                : cn(
                                    'border-transparent text-white',
                                    labBookEntryColorClass(
                                      segment.event.labEntry.entry_type
                                    )
                                  ),
                              segment.event.kind === 'lab-book'
                                ? 'rounded-none [clip-path:polygon(6px_0,calc(100%_-_6px)_0,100%_50%,calc(100%_-_6px)_100%,6px_100%,0_50%)]'
                                : cn(
                                    segment.continuesBefore
                                      ? 'rounded-l-none border-l-0'
                                      : 'rounded-l-md',
                                    segment.continuesAfter
                                      ? 'rounded-r-none border-r-0'
                                      : 'rounded-r-md'
                                  )
                            )}
                            style={{
                              gridColumn: `${segment.column} / span ${segment.span}`,
                              gridRow: segment.track + 1,
                            }}
                          >
                            {!segment.continuesBefore &&
                            !calendarDragBlockReason(
                              segment.event,
                              'resize-start'
                            ) ? (
                              <span
                                role="separator"
                                aria-label={`Resize start of ${segment.event.title}`}
                                onPointerDown={(event) =>
                                  beginCalendarEventDrag(
                                    segment.event,
                                    'resize-start',
                                    event
                                  )
                                }
                                className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize touch-none after:absolute after:bottom-1 after:left-0.5 after:top-1 after:w-px after:bg-current after:opacity-50"
                              />
                            ) : null}
                            <span className="pointer-events-none">
                              {segment.continuesBefore ? '↳ ' : ''}
                              {segment.event.title}
                            </span>
                            {!segment.continuesAfter &&
                            !calendarDragBlockReason(
                              segment.event,
                              'resize-end'
                            ) ? (
                              <span
                                role="separator"
                                aria-label={`Resize end of ${segment.event.title}`}
                                onPointerDown={(event) =>
                                  beginCalendarEventDrag(
                                    segment.event,
                                    'resize-end',
                                    event
                                  )
                                }
                                className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize touch-none after:absolute after:bottom-1 after:right-0.5 after:top-1 after:w-px after:bg-current after:opacity-50"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                  </div>
                </>
              ) : (
                <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
                  {yearMonths.map(({ month, weeks }, monthIndex) => (
                    <Fragment key={month.toISOString()}>
                      {monthIndex % 12 === 0 ? (
                        <header className="col-span-full flex items-center gap-3 border-y bg-slate-50 px-4 py-3 first:border-t-0 dark:bg-slate-900/70">
                          <h3 className="font-display text-base font-semibold tabular-nums">
                            {month.getFullYear()}
                          </h3>
                          <span className="text-[11px] text-muted-foreground">
                            {monthIndex === 0 ? 'Current planning year' : 'Following year'}
                          </span>
                        </header>
                      ) : null}
                      <section className="bg-card px-3 pb-3 pt-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCalendarMonth(month);
                          setCalendarView('month');
                        }}
                        className="mb-2 w-full rounded-md px-1 py-1 text-left font-display text-xs font-semibold hover:bg-muted"
                      >
                        {new Intl.DateTimeFormat('en-GB', {
                          month: 'long',
                        }).format(month)}
                      </button>
                      <div className="grid grid-cols-7 border-b">
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(
                          (weekday, weekdayIndex) => (
                            <span
                              key={`${weekday}-${weekdayIndex}`}
                              className="pb-1.5 text-center font-mono text-[8px] font-semibold text-muted-foreground"
                            >
                              {weekday}
                            </span>
                          )
                        )}
                      </div>
                      <div>
                        {weeks.map((week, weekIndex) => {
                          const segments = layoutYearWeekEvents(
                            displayedCalendarEvents,
                            week[0],
                            month
                          );
                          const trackCount = segments.reduce(
                            (count, segment) => Math.max(count, segment.track + 1),
                            0
                          );
                          return (
                            <div
                              key={week[0].toISOString()}
                              data-calendar-week-start={calendarDateKey(week[0])}
                              className="relative border-b last:border-b-0"
                              style={{ height: 23 + trackCount * 18 }}
                            >
                              <div className="grid h-[22px] grid-cols-7">
                                {week.map((day) => {
                                  const isInMonth =
                                    day.getMonth() === month.getMonth();
                                  const holiday = queueHolidayForCalendarDay(day);
                                  const weekend = day.getDay() === 0 || day.getDay() === 6;
                                  const today = isSameDay(day, new Date());
                                  const events = isInMonth
                                    ? displayedCalendarEvents.filter(
                                        (event) => calendarEventOccursOnDay(event, day)
                                      )
                                    : [];
                                  return isInMonth ? (
                                    <button
                                      key={day.toISOString()}
                                      type="button"
                                      data-calendar-date={calendarDateKey(day)}
                                      aria-current={today ? 'date' : undefined}
                                      onClick={() => {
                                        setCalendarMonth(month);
                                        setCalendarView('month');
                                      }}
                                      title={
                                        [
                                          new Intl.DateTimeFormat('en-GB', {
                                            dateStyle: 'medium',
                                          }).format(day),
                                          holiday ?? (weekend ? 'Weekend' : null),
                                          ...events.map((event) => event.title),
                                        ]
                                          .filter(Boolean)
                                          .join('\n')
                                      }
                                      className={cn(
                                        'grid place-items-center text-[9px] tabular-nums hover:bg-slate-100 focus-visible:z-20 dark:hover:bg-slate-800',
                                        (weekend || holiday) &&
                                          'bg-slate-100/70 text-muted-foreground dark:bg-slate-900/70',
                                        today &&
                                          'z-10 bg-blue-700 font-bold text-white ring-2 ring-inset ring-blue-950 shadow-[0_2px_5px_rgba(29,78,216,0.32)] hover:bg-blue-800 dark:bg-blue-500 dark:text-white dark:ring-blue-200 dark:hover:bg-blue-400'
                                      )}
                                    >
                                      {day.getDate()}
                                    </button>
                                  ) : (
                                    <span key={day.toISOString()} />
                                  );
                                })}
                              </div>
                              <div
                                className="pointer-events-none absolute inset-x-0 top-[22px] grid grid-cols-7 gap-y-0.5 px-0.5"
                                style={{ gridAutoRows: '16px' }}
                              >
                                {segments.map((segment) => (
                                  <div
                                    key={`${segment.event.id}-${segment.column}-${segment.span}`}
                                    role="button"
                                    tabIndex={0}
                                    onPointerDown={(event) =>
                                      beginCalendarEventDrag(
                                        segment.event,
                                        'move',
                                        event
                                      )
                                    }
                                    onContextMenu={(event) =>
                                      openCalendarRunContextMenu(segment.event, event)
                                    }
                                    onPointerEnter={(event) =>
                                      showCalendarEventHover(segment.event, event)
                                    }
                                    onPointerMove={(event) => {
                                      showCalendarEventHover(segment.event, event);
                                    }}
                                    onPointerLeave={() =>
                                      hideCalendarEventHover(segment.event.id)
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleCalendarEventClick(segment.event);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        openCalendarEvent(segment.event);
                                      }
                                    }}
                                    title={`${segment.event.title} · ${formatDay(
                                      segment.event.start
                                    )}–${formatDay(segment.event.end)}`}
                                    aria-label={`Edit ${segment.event.title}`}
                                    aria-describedby={
                                      calendarHover?.event.id === segment.event.id
                                        ? 'calendar-year-event-tooltip'
                                        : undefined
                                    }
                                    className={cn(
                                      'pointer-events-auto relative h-4 min-w-0 touch-none select-none overflow-hidden px-2.5 text-[8px] font-semibold leading-4 text-white shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition-[filter,opacity,transform,box-shadow] focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-white/90',
                                      calendarDragBlockReason(segment.event, 'move')
                                        ? 'cursor-pointer'
                                        : 'cursor-grab active:cursor-grabbing',
                                      compactEventColorClass(segment.event),
                                      calendarHover &&
                                        calendarHover.event.id !== segment.event.id &&
                                        'brightness-75 saturate-50',
                                      calendarHover?.event.id === segment.event.id &&
                                        'z-30 scale-y-110 brightness-110 ring-2 ring-white shadow-lg dark:ring-slate-950',
                                      calendarDrag?.event.id === segment.event.id &&
                                        'z-30 scale-y-110 brightness-110 ring-2 ring-white shadow-lg dark:ring-slate-950',
                                      segment.event.kind === 'lab-book'
                                        ? 'rounded-none [clip-path:polygon(6px_0,calc(100%_-_6px)_0,100%_50%,calc(100%_-_6px)_100%,6px_100%,0_50%)]'
                                        : cn(
                                            segment.continuesBefore
                                              ? 'rounded-l-none'
                                              : 'rounded-l-full',
                                            segment.continuesAfter
                                              ? 'rounded-r-none'
                                              : 'rounded-r-full'
                                          )
                                    )}
                                    style={{
                                      gridColumn: `${segment.column} / span ${segment.span}`,
                                      gridRow: segment.track + 1,
                                    }}
                                  >
                                    <span className="pointer-events-none block truncate drop-shadow-sm">
                                      {segment.event.title}
                                    </span>
                                    {!segment.continuesBefore &&
                                    !calendarDragBlockReason(
                                      segment.event,
                                      'resize-start'
                                    ) ? (
                                      <span
                                        role="separator"
                                        aria-label={`Resize start of ${segment.event.title}`}
                                        onPointerDown={(event) =>
                                          beginCalendarEventDrag(
                                            segment.event,
                                            'resize-start',
                                            event
                                          )
                                        }
                                        className="absolute -inset-y-0.5 left-0 z-20 w-2 cursor-ew-resize touch-none"
                                      />
                                    ) : null}
                                    {!segment.continuesAfter &&
                                    !calendarDragBlockReason(
                                      segment.event,
                                      'resize-end'
                                    ) ? (
                                      <span
                                        role="separator"
                                        aria-label={`Resize end of ${segment.event.title}`}
                                        onPointerDown={(event) =>
                                          beginCalendarEventDrag(
                                            segment.event,
                                            'resize-end',
                                            event
                                          )
                                        }
                                        className="absolute -inset-y-0.5 right-0 z-20 w-2 cursor-ew-resize touch-none"
                                      />
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </section>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-slate-50/70 px-4 py-2.5 text-[11px] text-muted-foreground dark:bg-slate-900/50">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-blue-500" /> Queue analysis window
            </span>
            <span className="flex items-center gap-1.5">
              <span className="flex h-2 w-5 gap-px [clip-path:polygon(4px_0,calc(100%_-_4px)_0,100%_50%,calc(100%_-_4px)_100%,4px_100%,0_50%)]">
                {['publication', 'results_delivery', 'maintenance', 'incident'].map(
                  (entryType) => (
                    <span
                      key={entryType}
                      className={cn(
                        'h-2 flex-1 rounded-[2px]',
                        labBookEntryColorClass(entryType)
                      )}
                    />
                  )
                )}
              </span>{' '}
              Lab-book item · Lab Book colors
            </span>
            <span className="ml-auto flex items-center gap-1.5 font-mono">
              {calendarDateMutation.isPending ||
              splitCalendarRunMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Pencil className="h-3 w-3" />
              )}{' '}
              {calendarDrag
                ? `${
                    calendarDrag.mode === 'move' ? 'Move' : 'Resize'
                  } · ${formatDay(calendarDrag.previewStart)}–${formatDay(
                    calendarDrag.previewEnd
                  )}`
                : splitCalendarRunMutation.isPending
                  ? 'Splitting queue run...'
                  : calendarDateMutation.isPending
                    ? 'Saving calendar dates…'
                    : calendarView === 'month'
                      ? 'Drag bars to move · drag edge grips to resize · right-click to split'
                      : 'Drag bands to move · drag ends to resize · right-click to split'}
            </span>
          </div>
        </section>
      </div>

      {calendarContextMenu
        ? (() => {
            const blockReason = calendarSplitBlockReason(
              calendarContextMenu.event,
              calendarContextMenu.day
            );
            return (
              <div
                ref={calendarContextMenuRef}
                role="menu"
                tabIndex={-1}
                aria-label={`Queue run actions for ${formatFullDay(
                  calendarContextMenu.day
                )}`}
                onContextMenu={(event) => event.preventDefault()}
                className="fixed z-[100] w-[232px] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
                style={{
                  left: calendarContextMenu.left,
                  top: calendarContextMenu.top,
                }}
              >
                <div className="border-b px-2 pb-2 pt-1">
                  <p className="truncate text-[11px] font-semibold">
                    {calendarContextMenu.event.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                    {formatFullDay(calendarContextMenu.day)}
                  </p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  disabled={Boolean(blockReason)}
                  onClick={splitCalendarRun}
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  <span>Split here</span>
                </button>
                <p className="px-2 pb-1 pt-0.5 text-[9px] leading-3.5 text-muted-foreground">
                  {blockReason ??
                    `The new run will start on ${formatFullDay(
                      calendarContextMenu.day
                    )}.`}
                </p>
              </div>
            );
          })()
        : null}

      {calendarView === 'year' && calendarHover && !calendarDrag ? (
        <div
          id="calendar-year-event-tooltip"
          role="tooltip"
          className="pointer-events-none fixed z-[90] w-72 rounded-lg border border-slate-700/70 bg-slate-950/95 px-3 py-2.5 text-white shadow-2xl shadow-slate-950/25 backdrop-blur dark:border-slate-200/60 dark:bg-white/95 dark:text-slate-950"
          style={{ left: calendarHover.left, top: calendarHover.top }}
        >
          <div className="flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-300 dark:text-slate-600">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                compactEventColorClass(calendarHover.event)
              )}
            />
            {calendarHover.event.kind === 'queue'
              ? 'Queue analysis window'
              : 'Lab Book event'}
          </div>
          <p className="mt-1.5 text-xs font-semibold leading-4">
            {calendarHover.event.title}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-300 dark:text-slate-600">
            {calendarHover.event.subtitle}
          </p>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/15 pt-2 font-mono text-[9px] text-slate-300 dark:border-slate-900/15 dark:text-slate-600">
            <span>
              {formatFullDay(calendarHover.event.start)}–
              {formatFullDay(calendarHover.event.end)}
            </span>
            <span className="shrink-0 capitalize">
              {calendarHover.event.kind === 'queue'
                ? queueStatusLabels[calendarHover.event.status]
                : calendarHover.event.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      ) : null}

      {queueEditorOpen ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setQueueEditorOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-editor-title"
            className="h-full w-full max-w-2xl overflow-y-auto border-l bg-background shadow-2xl"
          >
            <form onSubmit={saveQueue}>
              <div className="sticky top-0 z-10 flex items-start border-b bg-background/95 px-5 py-4 backdrop-blur">
                <div>
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
                    {editingQueue ? editingQueue.queue_code : 'New intake'}
                  </p>
                  <h2 id="queue-editor-title" className="mt-1 font-display text-xl font-semibold">
                    {editingQueue ? 'Edit queue item' : 'Check in samples'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editingQueue
                      ? 'Changes to the window and status sync to the linked lab-book item.'
                      : 'The analysis window is estimated automatically from live queue capacity.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQueueEditorOpen(false)}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close editor</span>
                </button>
              </div>

              <div className="space-y-3 p-3">
                <EditorSection title="Sample intake" icon={ArrowDownToLine}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Client or project">
                      <select
                        value={queueDraft.clientId}
                        onChange={(event) =>
                          setQueueDraft((value) => ({ ...value, clientId: event.target.value }))
                        }
                        className={selectClassName}
                      >
                        <option value="">Internal laboratory</option>
                        {(clientsQuery.data ?? []).map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Checked in">
                      <Input
                        required
                        type="datetime-local"
                        value={queueDraft.checkedInAt}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            checkedInAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px_150px]">
                    <Field label="Sample batch label">
                      <Input
                        required
                        value={queueDraft.sampleLabel}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            sampleLabel: event.target.value,
                          }))
                        }
                        placeholder="e.g. Atlantic cores · batch B"
                      />
                    </Field>
                    <Field label="Samples">
                      <Input
                        required
                        min={1}
                        step={1}
                        type="number"
                        value={queueDraft.sampleCount}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            sampleCount: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Average / week">
                      <Input
                        required
                        min={0.01}
                        step={0.01}
                        type="number"
                        value={queueDraft.samplesPerWeek}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            samplesPerWeek: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Analysis">
                      <select
                        value={queueDraft.analysisType}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            analysisType: event.target.value,
                          }))
                        }
                        className={selectClassName}
                      >
                        {analysisTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Matrix">
                      <Input
                        value={queueDraft.matrix}
                        onChange={(event) =>
                          setQueueDraft((value) => ({ ...value, matrix: event.target.value }))
                        }
                        placeholder="Soil, plant, water…"
                      />
                    </Field>
                    <Field label="Priority">
                      <select
                        value={queueDraft.priority}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            priority: event.target.value as QueuePriority,
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="routine">Routine</option>
                        <option value="priority">Priority</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </Field>
                    {editingQueue ? (
                      <Field label="Queue status">
                        <select
                          value={queueDraft.status}
                          onChange={(event) =>
                            setQueueDraft((value) => ({
                              ...value,
                              status: event.target.value as QueueStatus,
                            }))
                          }
                          className={selectClassName}
                        >
                          {Object.entries(queueStatusLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                  </div>
                </EditorSection>

                <EditorSection title="Schedule & ownership" icon={Clock3}>
                  {editingQueue ? (
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold">Instrument runs</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                            Split a run to pause this batch, schedule another batch, and resume later.
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 font-mono text-[9px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {queueDraft.segments.length} run{queueDraft.segments.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {queueDraft.segments.map((segment, index) => (
                        <div
                          key={segment.id ?? `new-run-${index}`}
                          className="rounded-lg border bg-slate-50/70 p-3 dark:bg-slate-900/50"
                        >
                          <div className="mb-2 flex items-center gap-2">
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-700 font-mono text-[9px] font-semibold text-white">
                              {index + 1}
                            </span>
                            <span className="text-[11px] font-semibold">Run {index + 1}</span>
                            <div className="ml-auto flex items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => splitQueueRun(index)}
                              >
                                Split run
                              </Button>
                              {queueDraft.segments.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeQueueRun(index)}
                                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-950/30"
                                  aria-label={`Remove run ${index + 1}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Starts">
                              <Input
                                required
                                type="date"
                                value={segment.start}
                                onChange={(event) =>
                                  setQueueDraft((value) => ({
                                    ...value,
                                    segments: value.segments.map((run, runIndex) =>
                                      runIndex === index
                                        ? { ...run, start: event.target.value }
                                        : run
                                    ),
                                  }))
                                }
                              />
                            </Field>
                            <Field label="Ends">
                              <Input
                                required
                                type="date"
                                value={segment.end}
                                onChange={(event) =>
                                  setQueueDraft((value) => ({
                                    ...value,
                                    segments: value.segments.map((run, runIndex) =>
                                      runIndex === index
                                        ? { ...run, end: event.target.value }
                                        : run
                                    ),
                                  }))
                                }
                              />
                            </Field>
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        Runs cannot overlap another active queue item on the same instrument. Planning skips Saturdays, Sundays, and São Paulo/Brazil lab holidays.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
                      <div className="flex gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-semibold">Capacity-aware estimate</p>
                          <p className="mt-0.5 text-blue-800 dark:text-blue-200">
                            The next open working day is combined with sample count and average
                            samples per week. Planning avoids instrument conflicts, weekends, and
                            São Paulo/Brazil lab holidays.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Instrument">
                      <select
                        value={queueDraft.assetId}
                        onChange={(event) =>
                          setQueueDraft((value) => ({ ...value, assetId: event.target.value }))
                        }
                        className={selectClassName}
                      >
                        <option value="">Assign later</option>
                        {(assetsQuery.data ?? []).map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.asset_code} · {asset.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Operator">
                      <Input
                        value={queueDraft.operator}
                        onChange={(event) =>
                          setQueueDraft((value) => ({
                            ...value,
                            operator: event.target.value,
                          }))
                        }
                        placeholder="Assign later"
                      />
                    </Field>
                  </div>
                </EditorSection>

                <EditorSection title="Sample list annexes" icon={Paperclip}>
                  {editingQueue && normalizeAttachments(editingQueue.attachments).length ? (
                    <div className="divide-y overflow-hidden rounded-lg border">
                      {normalizeAttachments(editingQueue.attachments).map((attachment) => (
                        <div key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
                          <span className="grid h-8 w-8 place-items-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            <FileSpreadsheet className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">{attachment.name}</p>
                            <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                              {formatFileSize(attachment.size)} · annexed{' '}
                              {formatDay(attachment.uploaded_at)}
                            </p>
                          </div>
                          <a
                            href={`/api/queue/${editingQueue.id}/files?attachment=${encodeURIComponent(
                              attachment.id
                            )}`}
                            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={`Download ${attachment.name}`}
                          >
                            <ArrowDownToLine className="h-4 w-4" />
                          </a>
                          <button
                            type="button"
                            onClick={() => void removeAttachment(attachment)}
                            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-950/30"
                            aria-label={`Remove ${attachment.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 hover:border-primary/50 hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">Annex sample list files</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        CSV, Excel, text, or PDF · up to 15 MB each
                      </span>
                    </span>
                    <input
                      type="file"
                      multiple
                      accept=".csv,.xlsx,.xls,.txt,.pdf"
                      className="sr-only"
                      onChange={(event) =>
                        setPendingFiles((current) => [
                          ...current,
                          ...Array.from(event.target.files ?? []),
                        ])
                      }
                    />
                  </label>
                  {pendingFiles.length ? (
                    <div className="flex flex-wrap gap-2">
                      {pendingFiles.map((file, index) => (
                        <span
                          key={`${file.name}-${file.lastModified}`}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-900"
                        >
                          <Paperclip className="h-3 w-3" />
                          {file.name}
                          <button
                            type="button"
                            onClick={() =>
                              setPendingFiles((files) =>
                                files.filter((_, fileIndex) => fileIndex !== index)
                              )
                            }
                            className="ml-1 rounded hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                            <span className="sr-only">Remove pending file</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Field label="Queue notes">
                    <textarea
                      value={queueDraft.notes}
                      onChange={(event) =>
                        setQueueDraft((value) => ({ ...value, notes: event.target.value }))
                      }
                      className={cn(textareaClassName, 'min-h-24')}
                      placeholder="Preparation constraints, contact details, or special handling…"
                    />
                  </Field>
                </EditorSection>
              </div>

              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">
                {editingQueue ? (
                  <p className="mr-auto hidden font-mono text-[9px] text-muted-foreground sm:block">
                    Checked in {formatDateTime(editingQueue.checked_in_at)}
                  </p>
                ) : (
                  <p className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
                    Files are annexed after the queue record is created.
                  </p>
                )}
                <Button type="button" variant="ghost" onClick={() => setQueueEditorOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveQueueMutation.isPending}>
                  {saveQueueMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {editingQueue ? 'Save queue item' : 'Check in samples'}
                </Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {labEditorOpen ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setLabEditorOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="lab-calendar-editor-title"
            className="h-full w-full max-w-xl overflow-y-auto border-l bg-background shadow-2xl"
          >
            <form onSubmit={saveLab}>
              <div className="flex items-start border-b px-5 py-4">
                <div>
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">
                    {editingLab ? 'Synced from lab book' : 'New lab-book event'}
                  </p>
                  <h2 id="lab-calendar-editor-title" className="mt-1 font-display text-xl font-semibold">
                    {editingLab ? 'Edit calendar item' : 'Add calendar item'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {editingLab
                      ? 'Changes made here appear in the Lab book page.'
                      : 'The selected date range is already filled in. Complete the event details.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLabEditorOpen(false)}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close editor</span>
                </button>
              </div>
              <div className="space-y-3 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Event type">
                    <select
                      value={labDraft.entryType}
                      onChange={(event) =>
                        setLabDraft((value) => ({
                          ...value,
                          entryType: event.target.value as LabEntryType,
                        }))
                      }
                      className={selectClassName}
                    >
                      {labEntryTypes.map((entryType) => (
                        <option key={entryType.value} value={entryType.value}>
                          {entryType.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select
                      value={labDraft.status}
                      onChange={(event) =>
                        setLabDraft((value) => ({
                          ...value,
                          status: event.target.value as QueueStatus,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="queued">Queued</option>
                      <option value="analysing">Analysing</option>
                      <option value="completed">Completed</option>
                    </select>
                  </Field>
                </div>
                <Field label="Title">
                  <Input
                    required
                    value={labDraft.title}
                    onChange={(event) =>
                      setLabDraft((value) => ({ ...value, title: event.target.value }))
                    }
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Starts">
                    <Input
                      required
                      type="date"
                      value={labDraft.start}
                      onChange={(event) =>
                        setLabDraft((value) => ({ ...value, start: event.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Ends">
                    <Input
                      required
                      type="date"
                      min={labDraft.start}
                      value={labDraft.end}
                      onChange={(event) =>
                        setLabDraft((value) => ({ ...value, end: event.target.value }))
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Equipment">
                    <select
                      value={labDraft.assetId}
                      onChange={(event) =>
                        setLabDraft((value) => ({
                          ...value,
                          assetId: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">No equipment link</option>
                      {(assetsQuery.data ?? []).map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.asset_code} · {asset.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Performed by">
                    <Input
                      value={labDraft.performedBy}
                      onChange={(event) =>
                        setLabDraft((value) => ({
                          ...value,
                          performedBy: event.target.value,
                        }))
                      }
                      placeholder="Assign later"
                    />
                  </Field>
                </div>
                <Field label="Description">
                  <textarea
                    value={labDraft.description}
                    onChange={(event) =>
                      setLabDraft((value) => ({ ...value, description: event.target.value }))
                    }
                    className={cn(textareaClassName, 'min-h-32')}
                  />
                </Field>
              </div>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">
                <Button type="button" variant="ghost" onClick={() => setLabEditorOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveLabMutation.isPending}>
                  {saveLabMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {editingLab ? 'Save calendar item' : 'Add calendar item'}
                </Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EditorSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof CalendarDays;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b pb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
          {title}
        </h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
