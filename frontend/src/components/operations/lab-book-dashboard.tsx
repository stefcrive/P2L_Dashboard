'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookMarked,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCheck2,
  FileText,
  FlaskConical,
  Gauge,
  GraduationCap,
  HardDrive,
  Monitor,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  AlertTriangle,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { EmptyState, StatusPill } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { labBookEntryColorClass } from '@/lib/lab-book/entry-colors';
import {
  createResource,
  deleteResource,
  fetchResource,
  selectClassName,
  textareaClassName,
  updateResource,
} from '@/lib/operations/client';
import { cn } from '@/lib/utils';

type Provider = { id: string; name: string };
type EntryType =
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
type DatePrecision = 'day' | 'month' | 'year' | 'cutoff' | 'estimated';
type EntryStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

type Asset = {
  id: string;
  asset_code: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  status: 'active' | 'service_due' | 'out_of_service' | 'retired';
  provider_id: string | null;
  last_service_at: string | null;
  next_service_at: string | null;
  maintenance_interval_months: number | null;
  notes: string | null;
  provider: Provider | null;
};

type EquipmentComponent = {
  id: string;
  asset_id: string;
  name: string;
  sort_order: number;
  maintenance_interval_months: number | null;
  last_maintenance_at: string | null;
  next_maintenance_at: string | null;
  notes: string | null;
};

type EquipmentComponentDraft = {
  key: string;
  id: string | null;
  name: string;
  maintenanceIntervalMonths: string;
  lastMaintenanceAt: string;
  nextMaintenanceAt: string;
  notes: string;
};

type LabEntry = {
  id: string;
  source_key: string | null;
  entry_type: EntryType;
  title: string;
  occurred_at: string;
  date_precision: DatePrecision;
  reported_at: string | null;
  asset_id: string | null;
  provider_id: string | null;
  status: EntryStatus;
  performed_by: string | null;
  description: string | null;
  source_reference: string | null;
  subject: string | null;
  institution: string | null;
  project_reference: string | null;
  material: string | null;
  quantity: number | null;
  next_due_at: string | null;
  asset: Pick<Asset, 'id' | 'asset_code' | 'name'> | null;
  provider: Provider | null;
};

type BackupRecord = {
  id: string;
  system_name: string;
  backup_type:
    | 'database'
    | 'documents'
    | 'instrument'
    | 'configuration'
    | 'full';
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed' | 'verified';
  destination: string | null;
  size_bytes: number | null;
  verified: boolean;
  notes: string | null;
};

type SortKey = 'date' | 'type' | 'title' | 'subject' | 'quantity' | 'status';

const entryTypeMeta: Record<
  EntryType,
  { label: string; short: string; color: string; icon: typeof FlaskConical }
> = {
  publication: {
    label: 'Publication',
    short: 'Publication',
    color: labBookEntryColorClass('publication'),
    icon: BookMarked,
  },
  masters_delivery: {
    label: 'MSc delivery',
    short: 'MSc',
    color: labBookEntryColorClass('masters_delivery'),
    icon: GraduationCap,
  },
  phd_delivery: {
    label: 'PhD delivery',
    short: 'PhD',
    color: labBookEntryColorClass('phd_delivery'),
    icon: ScrollText,
  },
  results_delivery: {
    label: 'Results delivery',
    short: 'Results',
    color: labBookEntryColorClass('results_delivery'),
    icon: FlaskConical,
  },
  maintenance: {
    label: 'Maintenance',
    short: 'Maintenance',
    color: labBookEntryColorClass('maintenance'),
    icon: Wrench,
  },
  calibration: {
    label: 'Calibration',
    short: 'Calibration',
    color: labBookEntryColorClass('calibration'),
    icon: Gauge,
  },
  incident: {
    label: 'Technical issue',
    short: 'Issue',
    color: labBookEntryColorClass('incident'),
    icon: AlertTriangle,
  },
  quality_control: {
    label: 'Quality control',
    short: 'Quality',
    color: labBookEntryColorClass('quality_control'),
    icon: ShieldCheck,
  },
  software: {
    label: 'Software',
    short: 'Software',
    color: labBookEntryColorClass('software'),
    icon: Monitor,
  },
  infrastructure: {
    label: 'Infrastructure',
    short: 'Infrastructure',
    color: labBookEntryColorClass('infrastructure'),
    icon: Zap,
  },
  sample_analysis: {
    label: 'Sample analysis',
    short: 'Analysis',
    color: labBookEntryColorClass('sample_analysis'),
    icon: FlaskConical,
  },
  general: {
    label: 'General note',
    short: 'Note',
    color: labBookEntryColorClass('general'),
    icon: FileText,
  },
};

function getEntryTypeMeta(entryType: string) {
  const knownMeta = entryTypeMeta[entryType as EntryType];
  if (knownMeta) return knownMeta;

  const label = entryType
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    label: label || 'Other',
    short: label || 'Other',
    color: labBookEntryColorClass(entryType),
    icon: FileText,
  };
}

const allEntryTypes = Object.keys(entryTypeMeta) as EntryType[];
const academicEntryTypes: EntryType[] = [
  'publication',
  'masters_delivery',
  'phd_delivery',
];
const chronologyEntryTypes = allEntryTypes.filter(
  (type) => !academicEntryTypes.includes(type)
);
const nowLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatRecordDate(value: string, precision: DatePrecision) {
  const date = new Date(value);
  if (precision === 'year') return String(date.getUTCFullYear());
  if (precision === 'cutoff') return `Through ${date.getUTCFullYear()}`;
  if (precision === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
  return precision === 'estimated' ? `c. ${formatted}` : formatted;
}

function formatSimpleDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(value)
  );
}

function statusLabel(entry: LabEntry) {
  if (entry.status === 'completed') {
    if (entry.entry_type === 'publication') return 'Published';
    if (entry.entry_type === 'results_delivery') return 'Delivered';
    if (entry.entry_type === 'incident') return 'Resolved';
    if (['masters_delivery', 'phd_delivery'].includes(entry.entry_type))
      return 'Recorded';
  }
  if (entry.status === 'in_progress') return 'Ongoing';
  return entry.status.replace('_', ' ');
}

function statusTone(status: string) {
  if (['active', 'completed', 'verified'].includes(status))
    return 'success' as const;
  if (['failed', 'out_of_service'].includes(status)) return 'danger' as const;
  if (['scheduled', 'service_due'].includes(status)) return 'warning' as const;
  if (['in_progress', 'running'].includes(status)) return 'primary' as const;
  return 'neutral' as const;
}

function isFutureSampleAnalysis(entry: LabEntry, presentTime: number) {
  return (
    entry.entry_type === 'sample_analysis' &&
    entry.status === 'scheduled' &&
    new Date(entry.occurred_at).getTime() > presentTime
  );
}

function blankDraft() {
  return {
    entryType: 'results_delivery' as EntryType,
    title: '',
    occurredAt: nowLocal(),
    datePrecision: 'day' as DatePrecision,
    reportedAt: '',
    assetId: '',
    providerId: '',
    status: 'completed' as EntryStatus,
    performedBy: '',
    description: '',
    sourceReference: '',
    subject: '',
    institution: '',
    projectReference: '',
    material: '',
    quantity: '',
    nextDueAt: '',
  };
}

export function LabBookDashboard() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<
    'records' | 'academic' | 'equipment' | 'backups'
  >('records');
  const [search, setSearch] = useState('');
  const [academicSearch, setAcademicSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | EntryType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | EntryStatus>('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showFutureQueue, setShowFutureQueue] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LabEntry | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [message, setMessage] = useState('');
  const editingMaintenanceAlert = Boolean(
    editingEntry?.source_key?.startsWith('maintenance:')
  );

  const providersQuery = useQuery({
    queryKey: ['operations', 'providers'],
    queryFn: () => fetchResource<Provider>('providers'),
    retry: false,
  });
  const assetsQuery = useQuery({
    queryKey: ['operations', 'assets'],
    queryFn: () => fetchResource<Asset>('assets'),
    retry: false,
  });
  const componentsQuery = useQuery({
    queryKey: ['operations', 'equipment-components'],
    queryFn: () =>
      fetchResource<EquipmentComponent>('equipment-components'),
    retry: false,
  });
  const entriesQuery = useQuery({
    queryKey: ['operations', 'lab-book'],
    queryFn: () => fetchResource<LabEntry>('lab-book'),
    retry: false,
  });
  const backupsQuery = useQuery({
    queryKey: ['operations', 'backups'],
    queryFn: () => fetchResource<BackupRecord>('backups'),
    retry: false,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['operations', 'lab-book'] }),
      queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
      queryClient.invalidateQueries({
        queryKey: ['operations-header-summary'],
      }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingEntry)
        return updateResource('lab-book', editingEntry.id, payload);
      return createResource('lab-book', payload);
    },
    onSuccess: async () => {
      setMessage(editingEntry ? 'Changes saved.' : 'Record added.');
      setEditorOpen(false);
      setEditingEntry(null);
      setDraft(blankDraft());
      await invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteResource('lab-book', id),
    onSuccess: async () => {
      setMessage('Record deleted.');
      setEditorOpen(false);
      setEditingEntry(null);
      await invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const assets = assetsQuery.data ?? [];
  const components = componentsQuery.data ?? [];
  const providers = providersQuery.data ?? [];
  const backups = backupsQuery.data ?? [];
  const databaseError =
    (entriesQuery.error as Error | null)?.message ??
    (assetsQuery.error as Error | null)?.message ??
    (componentsQuery.error as Error | null)?.message ??
    (backupsQuery.error as Error | null)?.message;

  const years = useMemo(
    () =>
      Array.from(
        new Set(
          entries.map((entry) => new Date(entry.occurred_at).getUTCFullYear())
        )
      )
        .sort((a, b) => b - a)
        .map(String),
    [entries]
  );

  const futureQueueEntries = useMemo(() => {
    const presentTime = Date.now();
    return entries
      .filter((entry) => isFutureSampleAnalysis(entry, presentTime))
      .sort(
        (left, right) =>
          new Date(left.occurred_at).getTime() -
          new Date(right.occurred_at).getTime()
      );
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const presentTime = Date.now();
    const visible = entries.filter((entry) => {
      if (academicEntryTypes.includes(entry.entry_type)) return false;
      if (isFutureSampleAnalysis(entry, presentTime)) return false;
      if (typeFilter !== 'all' && entry.entry_type !== typeFilter) return false;
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
      if (
        yearFilter !== 'all' &&
        String(new Date(entry.occurred_at).getUTCFullYear()) !== yearFilter
      )
        return false;
      if (!needle) return true;
      return [
        entry.title,
        entry.description,
        entry.subject,
        entry.institution,
        entry.project_reference,
        entry.material,
        entry.performed_by,
        entry.source_reference,
        entry.asset?.asset_code,
        entry.asset?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle);
    });
    const value = (entry: LabEntry): string | number => {
      if (sortKey === 'date') return new Date(entry.occurred_at).getTime();
      if (sortKey === 'type') return getEntryTypeMeta(entry.entry_type).label;
      if (sortKey === 'title') return entry.title;
      if (sortKey === 'subject') return entry.subject ?? '';
      if (sortKey === 'quantity') return entry.quantity ?? -1;
      return entry.status;
    };
    return [...visible].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b), undefined, {
              sensitivity: 'base',
            });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [
    entries,
    search,
    sortDirection,
    sortKey,
    statusFilter,
    typeFilter,
    yearFilter,
  ]);

  useEffect(
    () => setPage(1),
    [search, typeFilter, statusFilter, yearFilter, pageSize]
  );

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedEntries = filteredEntries.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  function changeSort(next: SortKey) {
    if (next === sortKey)
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(next);
      setSortDirection(next === 'date' || next === 'quantity' ? 'desc' : 'asc');
    }
  }

  function openNew(entryType: EntryType = 'results_delivery') {
    setEditingEntry(null);
    setDraft({ ...blankDraft(), entryType });
    setMessage('');
    setEditorOpen(true);
  }

  function openEdit(entry: LabEntry) {
    setEditingEntry(entry);
    setDraft({
      entryType: entry.entry_type,
      title: entry.title,
      occurredAt: toLocalInput(entry.occurred_at),
      datePrecision: entry.date_precision,
      reportedAt: toLocalInput(entry.reported_at),
      assetId: entry.asset_id ?? '',
      providerId: entry.provider_id ?? '',
      status: entry.status,
      performedBy: entry.performed_by ?? '',
      description: entry.description ?? '',
      sourceReference: entry.source_reference ?? '',
      subject: entry.subject ?? '',
      institution: entry.institution ?? '',
      projectReference: entry.project_reference ?? '',
      material: entry.material ?? '',
      quantity: entry.quantity === null ? '' : String(entry.quantity),
      nextDueAt: toLocalInput(entry.next_due_at),
    });
    setMessage('');
    setEditorOpen(true);
  }

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (editingMaintenanceAlert) {
      saveMutation.mutate({
        status: draft.status,
        occurred_at: new Date(draft.occurredAt).toISOString(),
        next_due_at: new Date(draft.occurredAt).toISOString(),
      });
      return;
    }
    saveMutation.mutate({
      entry_type: draft.entryType,
      title: draft.title.trim(),
      occurred_at: new Date(draft.occurredAt).toISOString(),
      date_precision: draft.datePrecision,
      reported_at: draft.reportedAt
        ? new Date(draft.reportedAt).toISOString()
        : null,
      asset_id: draft.assetId || null,
      provider_id: draft.providerId || null,
      status: draft.status,
      performed_by: draft.performedBy.trim() || null,
      description: draft.description.trim() || null,
      source_reference: draft.sourceReference.trim() || null,
      subject: draft.subject.trim() || null,
      institution: draft.institution.trim() || null,
      project_reference: draft.projectReference.trim() || null,
      material: draft.material.trim() || null,
      quantity: draft.quantity === '' ? null : Number(draft.quantity),
      next_due_at: draft.nextDueAt
        ? new Date(draft.nextDueAt).toISOString()
        : null,
    });
  }

  function requestDelete() {
    if (!editingEntry) return;
    if (
      window.confirm(`Delete “${editingEntry.title}”? This cannot be undone.`)
    ) {
      deleteMutation.mutate(editingEntry.id);
    }
  }

  const hasFilters =
    search ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    yearFilter !== 'all';

  if (databaseError) {
    return (
      <EmptyState
        error
        title="The laboratory book could not be loaded"
        description={databaseError}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-workspace">
      <header className="flex flex-col gap-2 border-b pb-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">
            P2L scientific record
          </p>
          <h1 className="mt-1 font-display text-lg font-semibold tracking-[-0.025em]">
            Lab book
          </h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {years.length
            ? `${years[years.length - 1]}—${years[0]}`
            : 'No records'}
        </p>
      </header>

      <div
        className="flex items-center gap-1 border-b"
        role="tablist"
        aria-label="Lab book views"
      >
        {(
          [
            ['records', 'Chronology', FileCheck2],
            ['academic', 'Publications & dissertations', BookMarked],
            ['equipment', 'Equipment', Gauge],
            ['backups', 'Backups', Database],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={activeView === value}
            onClick={() => setActiveView(value)}
            className={cn(
              'relative flex h-8 items-center gap-2 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground',
              activeView === value &&
                'text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-cyan-500'
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {activeView === 'records' ? (
        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b p-panel">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 lg:mr-auto">
                <h2 className="text-sm font-semibold">Chronological record</h2>
                <p className="text-[11px] text-muted-foreground">
                  {filteredEntries.length.toLocaleString('en-US')} matching
                  records through the present · click a row to inspect or edit
                </p>
              </div>
              <label className="relative">
                <span className="sr-only">Search records</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search people, projects, equipment, sources…"
                  className="pl-9 lg:w-[360px]"
                />
              </label>
              <Button onClick={() => openNew('results_delivery')}>
                <Plus className="mr-2 h-4 w-4" /> Add record
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={showFutureQueue ? 'secondary' : 'outline'}
                aria-expanded={showFutureQueue}
                aria-controls="future-sample-queue"
                disabled={!futureQueueEntries.length}
                onClick={() => setShowFutureQueue((value) => !value)}
              >
                <CalendarClock className="mr-2 h-3.5 w-3.5" />
                {futureQueueEntries.length
                  ? `Future sample queue (${futureQueueEntries.length})`
                  : 'No future analyses'}
                <ChevronRight
                  className={cn(
                    'ml-2 h-3.5 w-3.5 transition-transform',
                    showFutureQueue && 'rotate-90'
                  )}
                />
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Planned analyses stay separate from the laboratory record.
              </p>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-[180px_150px_120px_auto_1fr]">
              <select
                aria-label="Filter by record type"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as 'all' | EntryType)
                }
                className={selectClassName}
              >
                <option value="all">All record types</option>
                {chronologyEntryTypes.map((type) => (
                  <option key={type} value={type}>
                    {entryTypeMeta[type].label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | EntryStatus)
                }
                className={selectClassName}
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="in_progress">Ongoing</option>
                <option value="scheduled">Scheduled</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                aria-label="Filter by year"
                value={yearFilter}
                onChange={(event) => setYearFilter(event.target.value)}
                className={selectClassName}
              >
                <option value="all">All years</option>
                {years.map((year) => (
                  <option key={year}>{year}</option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!hasFilters}
                onClick={() => {
                  setSearch('');
                  setTypeFilter('all');
                  setStatusFilter('all');
                  setYearFilter('all');
                }}
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset
              </Button>
              {message ? (
                <p
                  className="self-center text-xs text-emerald-700 lg:justify-self-end dark:text-emerald-300"
                  aria-live="polite"
                >
                  {message}
                </p>
              ) : null}
            </div>
          </div>
          {showFutureQueue ? (
            <div
              id="future-sample-queue"
              className="border-b bg-cyan-50/35 dark:bg-cyan-950/10"
            >
              <div className="flex items-end justify-between gap-3 border-b p-panel">
                <div>
                  <h3 className="text-xs font-semibold">Upcoming analyses</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Nearest scheduled start first
                  </p>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {futureQueueEntries.length} scheduled
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto overscroll-contain">
                {futureQueueEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => openEdit(entry)}
                    className="grid w-full gap-1 border-b p-panel text-left transition-colors last:border-b-0 hover:bg-cyan-50 focus-visible:bg-cyan-50 sm:grid-cols-[150px_minmax(0,1fr)_110px] sm:items-center dark:hover:bg-cyan-950/25 dark:focus-visible:bg-cyan-950/25"
                  >
                    <span className="font-mono text-[11px] font-medium tabular-nums text-cyan-800 dark:text-cyan-200">
                      {formatRecordDate(entry.occurred_at, entry.date_precision)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">
                        {entry.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {[entry.subject, entry.institution, entry.project_reference]
                          .filter(Boolean)
                          .join(' · ') || 'Sample analysis'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 sm:justify-end">
                      {entry.quantity !== null ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {entry.quantity} analyses
                        </span>
                      ) : null}
                      <StatusPill tone={statusTone(entry.status)}>
                        {statusLabel(entry)}
                      </StatusPill>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {pagedEntries.length ? (
            <div className="workspace-table overflow-auto" tabIndex={0} role="region" aria-label="Laboratory records">
              <table className="w-full min-w-[1060px] text-left text-xs">
                <thead className="border-b bg-slate-50/80 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground dark:bg-slate-900/70">
                  <tr>
                    <SortableHead
                      label="Date"
                      sort="date"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className="w-[132px] pl-6"
                    />
                    <SortableHead
                      label="Record"
                      sort="title"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                    />
                    <SortableHead
                      label="Type"
                      sort="type"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className="w-[150px]"
                    />
                    <SortableHead
                      label="Person / project"
                      sort="subject"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className="w-[220px]"
                    />
                    <SortableHead
                      label="Qty"
                      sort="quantity"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className="w-[90px] text-right"
                    />
                    <SortableHead
                      label="Status"
                      sort="status"
                      active={sortKey}
                      direction={sortDirection}
                      onSort={changeSort}
                      className="w-[110px]"
                    />
                    <th className="w-12 px-3">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedEntries.map((entry) => {
                    const meta = getEntryTypeMeta(entry.entry_type);
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => openEdit(entry)}
                        className="group cursor-pointer align-top transition-colors hover:bg-cyan-50/50 dark:hover:bg-cyan-950/15"
                      >
                        <td className="relative px-2 py-1.5 pl-4 font-mono text-[11px] font-medium tabular-nums whitespace-nowrap">
                          <span
                            className={cn(
                              'absolute inset-y-0 left-0 w-1',
                              meta.color
                            )}
                          />
                          {formatRecordDate(
                            entry.occurred_at,
                            entry.date_precision
                          )}
                          {entry.reported_at ? (
                            <span className="mt-1 flex items-center gap-1 text-[9px] font-normal text-muted-foreground">
                              <CalendarClock className="h-3 w-3" /> reported{' '}
                              {formatSimpleDate(entry.reported_at)}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-[520px] px-2 py-1.5">
                          <p className="font-semibold leading-5 text-foreground">
                            {entry.title}
                          </p>
                          {entry.description || entry.source_reference ? (
                            <details onClick={(event) => event.stopPropagation()} className="text-[11px] text-muted-foreground">
                              <summary className="w-fit cursor-pointer rounded-sm py-0.5">Details and source</summary>
                              {entry.description ? <p className="max-w-[70ch] whitespace-normal py-1 leading-4">{entry.description}</p> : null}
                              {entry.source_reference ? <p className="max-w-[70ch] break-all py-1 font-mono">Source · {entry.source_reference}</p> : null}
                            </details>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium">
                            <span
                              className={cn(
                                'grid h-5 w-5 place-items-center rounded',
                                meta.color,
                                'text-white'
                              )}
                            >
                              <Icon className="h-3 w-3" />
                            </span>
                            {meta.short}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <p className="font-medium">
                            {entry.subject ??
                              entry.project_reference ??
                              entry.asset?.asset_code ??
                              '—'}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {entry.project_reference && entry.subject
                              ? entry.project_reference
                              : (entry.institution ??
                                entry.asset?.name ??
                                entry.material ??
                                '')}
                          </p>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
                          {entry.quantity === null
                            ? '—'
                            : entry.quantity.toLocaleString('en-US')}
                        </td>
                        <td className="px-2 py-1.5">
                          <StatusPill tone={statusTone(entry.status)}>
                            {statusLabel(entry)}
                          </StatusPill>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button type="button" onClick={(event) => { event.stopPropagation(); openEdit(entry); }} aria-label={`Edit ${entry.title}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={entriesQuery.isPending ? 'Loading laboratory records' : 'No matching records'}
              description={entriesQuery.isPending ? 'Retrieving the laboratory chronology.' : 'Change the search or filters, or add a new lab-book record.'}
            />
          )}
          <div className="flex flex-col gap-3 border-t bg-slate-50/60 px-4 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center dark:bg-slate-900/40">
            <label className="flex items-center gap-2">
              Rows
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-7 rounded border bg-background px-2 text-[11px]"
              >
                {[25, 50, 100].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
            <span className="sm:ml-auto">
              Page {safePage} of {pageCount}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
              >
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {activeView === 'academic' ? (
        <AcademicView
          entries={entries}
          search={academicSearch}
          onSearch={setAcademicSearch}
          onEdit={openEdit}
          onAdd={() => openNew('publication')}
          message={message}
        />
      ) : null}

      {activeView === 'equipment' ? (
        <EquipmentView
          assets={assets}
          components={components}
          providers={providers}
        />
      ) : null}
      {activeView === 'backups' ? <BackupsView backups={backups} /> : null}

      {editorOpen ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-slate-950/35 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditorOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-editor-title"
            className="h-full w-full max-w-xl overflow-y-auto border-l bg-background shadow-2xl"
          >
            <form onSubmit={submitEntry}>
              <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background/95 px-5 py-4 backdrop-blur">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">
                    {editingEntry ? 'Record editor' : 'New chronology entry'}
                  </p>
                  <h2
                    id="entry-editor-title"
                    className="mt-1 font-display text-xl font-semibold"
                  >
                    {editingEntry ? 'Edit record' : 'Add to lab book'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close editor</span>
                </button>
              </div>

              <div className="space-y-3 p-3">
                {editingMaintenanceAlert ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    This alert is generated from the equipment schedule. You
                    can reschedule it or update its status here; manage its
                    identity, interval, and components from Equipment.
                  </div>
                ) : editingEntry?.source_key ? (
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] leading-5 text-cyan-900 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-200">
                    This record was reconstructed from source material. Edits
                    are preserved and the original source remains linked for
                    audit.
                  </div>
                ) : null}

                <EditorSection title="Record identity">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Record type">
                      <select
                        disabled={editingMaintenanceAlert}
                        value={draft.entryType}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            entryType: event.target.value as EntryType,
                          }))
                        }
                        className={selectClassName}
                      >
                        {allEntryTypes.map((type) => (
                          <option key={type} value={type}>
                            {entryTypeMeta[type].label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Status">
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            status: event.target.value as EntryStatus,
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="completed">Completed / delivered</option>
                        <option value="in_progress">Ongoing</option>
                        <option value="scheduled">Scheduled</option>
                        {!editingMaintenanceAlert ? (
                          <>
                            <option value="failed">Failed</option>
                            <option value="cancelled">Cancelled</option>
                          </>
                        ) : null}
                      </select>
                    </Field>
                  </div>
                  <Field label="Title">
                    <Input
                      required
                      readOnly={editingMaintenanceAlert}
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          title: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <div className="grid grid-cols-[1fr_150px] gap-3">
                    <Field label="Event date">
                      <Input
                        required
                        type="datetime-local"
                        value={draft.occurredAt}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            occurredAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Date precision">
                      <select
                        disabled={editingMaintenanceAlert}
                        value={draft.datePrecision}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            datePrecision: event.target.value as DatePrecision,
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="day">Exact day</option>
                        <option value="month">Month only</option>
                        <option value="year">Year only</option>
                        <option value="estimated">Estimated</option>
                        <option value="cutoff">Through cutoff</option>
                      </select>
                    </Field>
                  </div>
                </EditorSection>

                {!editingMaintenanceAlert ? (
                  <EditorSection title="Scientific context">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Person / recipient">
                      <Input
                        value={draft.subject}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            subject: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Institution">
                      <Input
                        value={draft.institution}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            institution: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Project / core">
                      <Input
                        value={draft.projectReference}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            projectReference: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Material">
                      <Input
                        value={draft.material}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            material: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Number of analyses">
                      <Input
                        min="0"
                        step="1"
                        type="number"
                        value={draft.quantity}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            quantity: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Equipment">
                      <select
                        value={draft.assetId}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            assetId: event.target.value,
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="">No equipment</option>
                        {assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.asset_code} · {asset.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description / findings">
                    <textarea
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          description: event.target.value,
                        }))
                      }
                      className={cn(textareaClassName, 'min-h-32 leading-5')}
                    />
                  </Field>
                  </EditorSection>
                ) : null}

                {!editingMaintenanceAlert ? (
                  <EditorSection title="Traceability">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Performed by">
                      <Input
                        value={draft.performedBy}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            performedBy: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Provider">
                      <select
                        value={draft.providerId}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            providerId: event.target.value,
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="">No provider</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reported at">
                      <Input
                        type="datetime-local"
                        value={draft.reportedAt}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            reportedAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Next due">
                      <Input
                        type="datetime-local"
                        value={draft.nextDueAt}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            nextDueAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Source reference">
                    <Input
                      value={draft.sourceReference}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          sourceReference: event.target.value,
                        }))
                      }
                      placeholder="File, email, notebook page, DOI…"
                    />
                  </Field>
                  </EditorSection>
                ) : null}
              </div>

              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">
                {editingMaintenanceAlert ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditorOpen(false);
                      setEditingEntry(null);
                      setActiveView('equipment');
                    }}
                  >
                    <Wrench className="mr-2 h-3.5 w-3.5" /> Manage schedule
                  </Button>
                ) : editingEntry ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-950/30"
                    disabled={deleteMutation.isPending}
                    onClick={requestDelete}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setEditorOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Save record'}
                </Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function SortableHead({
  label,
  sort,
  active,
  direction,
  onSort,
  className,
}: {
  label: string;
  sort: SortKey;
  active: SortKey;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const Icon =
    active === sort ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn('px-3 py-2.5 font-medium', className)}>
      <button
        type="button"
        onClick={() => onSort(sort)}
        className="inline-flex items-center gap-1.5 hover:text-foreground"
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[11px] font-semibold text-foreground">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function EditorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 w-full border-b pb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function AcademicView({
  entries,
  search,
  onSearch,
  onEdit,
  onAdd,
  message,
}: {
  entries: LabEntry[];
  search: string;
  onSearch: (value: string) => void;
  onEdit: (entry: LabEntry) => void;
  onAdd: () => void;
  message: string;
}) {
  const needle = search.trim().toLocaleLowerCase();
  const academicEntries = entries.filter((entry) => {
    if (!academicEntryTypes.includes(entry.entry_type)) return false;
    if (!needle) return true;
    return [
      getEntryTypeMeta(entry.entry_type).label,
      entry.title,
      entry.subject,
      entry.institution,
      entry.description,
      entry.source_reference,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle);
  });
  const publications = academicEntries
    .filter((entry) => entry.entry_type === 'publication')
    .sort(
      (left, right) =>
        new Date(right.occurred_at).getTime() -
          new Date(left.occurred_at).getTime() ||
        left.title.localeCompare(right.title)
    );
  const masters = academicEntries
    .filter((entry) => entry.entry_type === 'masters_delivery')
    .sort((left, right) =>
      (left.subject ?? left.title).localeCompare(right.subject ?? right.title)
    );
  const phds = academicEntries
    .filter((entry) => entry.entry_type === 'phd_delivery')
    .sort((left, right) =>
      (left.subject ?? left.title).localeCompare(right.subject ?? right.title)
    );

  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b p-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 lg:mr-auto">
            <h2 className="text-sm font-semibold">
              Publications & dissertations
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {publications.length} publications · {masters.length} MSc ·{' '}
              {phds.length} PhD
            </p>
          </div>
          <label className="relative">
            <span className="sr-only">
              Search publications and dissertations
            </span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search titles, authors, people, journals…"
              className="pl-9 lg:w-[360px]"
            />
          </label>
          <Button onClick={onAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add record
          </Button>
        </div>
        {message ? (
          <p
            className="mt-2 text-right text-xs text-emerald-700 dark:text-emerald-300"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
        <div className="min-w-0 xl:border-r">
          <div className="flex items-center gap-2 border-b bg-slate-50/70 px-4 py-2.5 dark:bg-slate-900/50">
            <BookMarked className="h-3.5 w-3.5 text-violet-600" />
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
              Publication list
            </h3>
          </div>
          {publications.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="w-20 px-4 py-2.5 font-medium">Year</th>
                    <th className="px-3 py-2.5 font-medium">Publication</th>
                    <th className="w-[34%] px-3 py-2.5 font-medium">Source</th>
                    <th className="w-10 px-3 py-2.5">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {publications.map((entry) => (
                    <tr
                      key={entry.id}
                      onClick={() => onEdit(entry)}
                      className="group cursor-pointer align-top transition-colors hover:bg-violet-50/45 dark:hover:bg-violet-950/15"
                    >
                      <td className="px-4 py-3 font-mono font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                        {formatRecordDate(
                          entry.occurred_at,
                          entry.date_precision
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold leading-5">{entry.title}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                          {entry.subject ?? 'Authors not recorded'}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-[11px] leading-4 text-muted-foreground">
                        <p className="line-clamp-3">
                          {entry.institution ?? '—'}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-violet-600" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No matching publications"
              description="Change the search or add a publication record."
            />
          )}
        </div>

        <div className="min-w-0">
          <DegreeList
            title="MSc dissertations"
            entries={masters}
            icon={GraduationCap}
            tone="sky"
            onEdit={onEdit}
          />
          <DegreeList
            title="PhD dissertations"
            entries={phds}
            icon={ScrollText}
            tone="indigo"
            onEdit={onEdit}
            bordered
          />
        </div>
      </div>
    </section>
  );
}

function DegreeList({
  title,
  entries,
  icon: Icon,
  tone,
  onEdit,
  bordered = false,
}: {
  title: string;
  entries: LabEntry[];
  icon: typeof GraduationCap;
  tone: 'sky' | 'indigo';
  onEdit: (entry: LabEntry) => void;
  bordered?: boolean;
}) {
  return (
    <section className={cn(bordered && 'border-t')}>
      <div className="flex items-center gap-2 border-b bg-slate-50/70 px-4 py-2.5 dark:bg-slate-900/50">
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            tone === 'sky' ? 'text-sky-600' : 'text-indigo-600'
          )}
        />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
          {title}
        </h3>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {entries.length}
        </span>
      </div>
      {entries.length ? (
        <div className="divide-y">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onEdit(entry)}
              className="group flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900/60"
            >
              <span
                className={cn(
                  'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                  tone === 'sky' ? 'bg-sky-500' : 'bg-indigo-500'
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {entry.subject ?? entry.title}
                </span>
                <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">
                  {formatRecordDate(entry.occurred_at, entry.date_precision)}
                </span>
              </span>
              <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-cyan-600" />
            </button>
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
          No matching records
        </p>
      )}
    </section>
  );
}

function newComponentDraft(): EquipmentComponentDraft {
  return {
    key: crypto.randomUUID(),
    id: null,
    name: '',
    maintenanceIntervalMonths: '',
    lastMaintenanceAt: '',
    nextMaintenanceAt: '',
    notes: '',
  };
}

function componentToDraft(
  component: EquipmentComponent
): EquipmentComponentDraft {
  return {
    key: component.id,
    id: component.id,
    name: component.name,
    maintenanceIntervalMonths:
      component.maintenance_interval_months?.toString() ?? '',
    lastMaintenanceAt: toLocalInput(component.last_maintenance_at),
    nextMaintenanceAt: toLocalInput(component.next_maintenance_at),
    notes: component.notes ?? '',
  };
}

function componentPayload(
  component: EquipmentComponentDraft,
  assetId: string,
  sortOrder: number
) {
  return {
    asset_id: assetId,
    name: component.name.trim(),
    sort_order: sortOrder,
    maintenance_interval_months: component.maintenanceIntervalMonths
      ? Number(component.maintenanceIntervalMonths)
      : null,
    last_maintenance_at: component.lastMaintenanceAt
      ? new Date(component.lastMaintenanceAt).toISOString()
      : null,
    next_maintenance_at: component.nextMaintenanceAt
      ? new Date(component.nextMaintenanceAt).toISOString()
      : null,
    notes: component.notes.trim() || null,
  };
}

function EquipmentView({
  assets,
  components,
  providers,
}: {
  assets: Asset[];
  components: EquipmentComponent[];
  providers: Provider[];
}) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [message, setMessage] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [componentDrafts, setComponentDrafts] = useState<
    EquipmentComponentDraft[]
  >([]);
  const [draft, setDraft] = useState({
    code: '',
    name: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    location: '',
    status: 'active' as Asset['status'],
    providerId: '',
    lastServiceAt: '',
    nextServiceAt: '',
    maintenanceIntervalMonths: '',
    notes: '',
  });

  const saveMutation = useMutation({
    mutationFn: async ({
      assetPayload,
      componentDrafts: nextComponents,
    }: {
      assetPayload: Record<string, unknown>;
      componentDrafts: EquipmentComponentDraft[];
    }) => {
      const asset = editingAsset
        ? await updateResource<Asset>('assets', editingAsset.id, assetPayload)
        : await createResource<Asset>('assets', assetPayload);
      const priorComponents = components.filter(
        (component) => component.asset_id === asset.id
      );
      const retainedIds = new Set(
        nextComponents.flatMap((component) =>
          component.id ? [component.id] : []
        )
      );

      await Promise.all([
        ...nextComponents.map((component, index) =>
          component.id
            ? updateResource(
                'equipment-components',
                component.id,
                componentPayload(component, asset.id, index)
              )
            : createResource(
                'equipment-components',
                componentPayload(component, asset.id, index)
              )
        ),
        ...priorComponents
          .filter((component) => !retainedIds.has(component.id))
          .map((component) =>
            deleteResource('equipment-components', component.id)
          ),
      ]);

      return asset;
    },
    onSuccess: async () => {
      setMessage(editingAsset ? 'Equipment updated.' : 'Equipment added.');
      setEditorOpen(false);
      setEditingAsset(null);
      setComponentDrafts([]);
      setScheduleError('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'assets'] }),
        queryClient.invalidateQueries({
          queryKey: ['operations', 'equipment-components'],
        }),
        queryClient.invalidateQueries({ queryKey: ['operations', 'lab-book'] }),
        queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
        queryClient.invalidateQueries({
          queryKey: ['operations-header-summary'],
        }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteResource('assets', id),
    onSuccess: async () => {
      setMessage('Equipment deleted.');
      setEditorOpen(false);
      setEditingAsset(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'assets'] }),
        queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  function blankAsset() {
    return {
      code: '',
      name: '',
      manufacturer: '',
      model: '',
      serialNumber: '',
      location: '',
      status: 'active' as Asset['status'],
      providerId: '',
      lastServiceAt: '',
      nextServiceAt: '',
      maintenanceIntervalMonths: '',
      notes: '',
    };
  }

  function openNewAsset() {
    setEditingAsset(null);
    setDraft(blankAsset());
    setComponentDrafts([]);
    setScheduleError('');
    setMessage('');
    setEditorOpen(true);
  }

  function openAsset(asset: Asset) {
    setEditingAsset(asset);
    setDraft({
      code: asset.asset_code,
      name: asset.name,
      manufacturer: asset.manufacturer ?? '',
      model: asset.model ?? '',
      serialNumber: asset.serial_number ?? '',
      location: asset.location ?? '',
      status: asset.status,
      providerId: asset.provider_id ?? '',
      lastServiceAt: toLocalInput(asset.last_service_at),
      nextServiceAt: toLocalInput(asset.next_service_at),
      maintenanceIntervalMonths:
        asset.maintenance_interval_months?.toString() ?? '',
      notes: asset.notes ?? '',
    });
    setComponentDrafts(
      components
        .filter((component) => component.asset_id === asset.id)
        .sort((left, right) => left.sort_order - right.sort_order)
        .map(componentToDraft)
    );
    setScheduleError('');
    setMessage('');
    setEditorOpen(true);
  }

  function saveAsset(event: FormEvent) {
    event.preventDefault();
    const assetScheduleIsPartial = Boolean(draft.nextServiceAt) !==
      Boolean(draft.maintenanceIntervalMonths);
    const incompleteComponent = componentDrafts.find(
      (component) =>
        Boolean(component.nextMaintenanceAt) !==
        Boolean(component.maintenanceIntervalMonths)
    );
    if (assetScheduleIsPartial) {
      setScheduleError(
        'Equipment alerts need both a next service date and a repeat interval.'
      );
      return;
    }
    if (incompleteComponent) {
      setScheduleError(
        `${incompleteComponent.name || 'This component'} needs both a next maintenance date and a repeat interval.`
      );
      return;
    }
    setScheduleError('');
    saveMutation.mutate({
      assetPayload: {
        asset_code: draft.code.trim(),
        name: draft.name.trim(),
        manufacturer: draft.manufacturer.trim() || null,
        model: draft.model.trim() || null,
        serial_number: draft.serialNumber.trim() || null,
        location: draft.location.trim() || null,
        status: draft.status,
        provider_id: draft.providerId || null,
        last_service_at: draft.lastServiceAt
          ? new Date(draft.lastServiceAt).toISOString()
          : null,
        next_service_at: draft.nextServiceAt
          ? new Date(draft.nextServiceAt).toISOString()
          : null,
        maintenance_interval_months: draft.maintenanceIntervalMonths
          ? Number(draft.maintenanceIntervalMonths)
          : null,
        notes: draft.notes.trim() || null,
      },
      componentDrafts,
    });
  }

  function requestAssetDelete() {
    if (!editingAsset) return;
    if (
      window.confirm(
        `Delete “${editingAsset.asset_code} · ${editingAsset.name}”? Existing lab-book entries will keep their history but lose this equipment link.`
      )
    ) {
      deleteMutation.mutate(editingAsset.id);
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-panel sm:flex-row sm:items-center">
          <div className="sm:mr-auto">
            <h2 className="text-sm font-semibold">Equipment register</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {assets.length} assets · select a card to edit its service record.
            </p>
          </div>
          {message ? (
            <p
              className="text-xs text-emerald-700 dark:text-emerald-300"
              aria-live="polite"
            >
              {message}
            </p>
          ) : null}
          <Button onClick={openNewAsset}>
            <Plus className="mr-2 h-4 w-4" /> Add equipment
          </Button>
        </div>
        {assets.length ? (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => openAsset(asset)}
                className="group bg-card p-4 text-left transition-colors hover:bg-cyan-50/50 dark:hover:bg-cyan-950/15"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                    {asset.asset_code}
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusPill tone={statusTone(asset.status)}>
                      {asset.status.replace('_', ' ')}
                    </StatusPill>
                    <Pencil className="h-3.5 w-3.5 text-slate-300 group-hover:text-cyan-600" />
                  </span>
                </div>
                <h3 className="mt-2 font-display text-base font-semibold">
                  {asset.name}
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {[asset.manufacturer, asset.model]
                    .filter(Boolean)
                    .join(' · ') || 'Manufacturer not recorded'}
                </p>
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-3 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">Location</dt>
                    <dd className="mt-0.5 font-medium">
                      {asset.location ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Next service</dt>
                    <dd className="mt-0.5 font-mono">
                      {formatSimpleDate(asset.next_service_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Components</dt>
                    <dd className="mt-0.5 font-medium">
                      {
                        components.filter(
                          (component) => component.asset_id === asset.id
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No equipment assets"
            description="Add the first instrument or supporting asset."
            action={<Button onClick={openNewAsset}>Add equipment</Button>}
          />
        )}
      </section>

      {editorOpen ? (
        <div
          className="fixed inset-0 z-[70] flex justify-end bg-slate-950/35 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditorOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="equipment-editor-title"
            className="h-full w-full max-w-2xl overflow-y-auto border-l bg-background shadow-2xl"
          >
            <form onSubmit={saveAsset}>
              <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background/95 px-5 py-4 backdrop-blur">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">
                    Equipment register
                  </p>
                  <h2
                    id="equipment-editor-title"
                    className="mt-1 font-display text-xl font-semibold"
                  >
                    {editingAsset ? 'Edit equipment' : 'Add equipment'}
                  </h2>
                  <a
                    href="#equipment-components"
                    className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 hover:underline dark:text-cyan-300"
                  >
                    <Wrench className="h-3 w-3" />
                    {componentDrafts.length
                      ? `${componentDrafts.length} ${componentDrafts.length === 1 ? 'component' : 'components'} · view schedules`
                      : 'Add component schedules'}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close editor</span>
                </button>
              </div>

              <div className="space-y-3 p-3">
                {scheduleError ? (
                  <p
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                    role="alert"
                  >
                    {scheduleError}
                  </p>
                ) : null}
                <EditorSection title="Asset identity">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Asset code">
                      <Input
                        required
                        value={draft.code}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            code: event.target.value,
                          }))
                        }
                        placeholder="IRMS-01"
                      />
                    </Field>
                    <Field label="Status">
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            status: event.target.value as Asset['status'],
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value="active">Active</option>
                        <option value="service_due">Service due</option>
                        <option value="out_of_service">Out of service</option>
                        <option value="retired">Retired</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Equipment name">
                    <Input
                      required
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          name: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Manufacturer">
                      <Input
                        value={draft.manufacturer}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            manufacturer: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Model">
                      <Input
                        value={draft.model}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            model: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Serial number">
                      <Input
                        value={draft.serialNumber}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            serialNumber: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Location">
                      <Input
                        value={draft.location}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            location: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                </EditorSection>

                <EditorSection title="Service & responsibility">
                  <Field label="Service provider">
                    <select
                      value={draft.providerId}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          providerId: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">No provider</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Last service">
                      <Input
                        type="datetime-local"
                        value={draft.lastServiceAt}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            lastServiceAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Next service">
                      <Input
                        type="datetime-local"
                        value={draft.nextServiceAt}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            nextServiceAt: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Repeat every (months)">
                      <Input
                        min="1"
                        step="1"
                        type="number"
                        value={draft.maintenanceIntervalMonths}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            maintenanceIntervalMonths: event.target.value,
                          }))
                        }
                        placeholder="12"
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    Set a next service date and repeat interval to add a
                    maintenance alert to the calendar and lab book. Completing
                    the alert schedules the next occurrence automatically.
                  </p>
                  <Field label="Notes">
                    <textarea
                      value={draft.notes}
                      onChange={(event) =>
                        setDraft((value) => ({
                          ...value,
                          notes: event.target.value,
                        }))
                      }
                      className={cn(textareaClassName, 'min-h-28')}
                    />
                  </Field>
                </EditorSection>

                <div id="equipment-components" className="scroll-mt-24">
                  <EditorSection title="Components & component maintenance">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      Track serviceable parts separately and give each one its
                      own recurring alert.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setComponentDrafts((value) => [
                          ...value,
                          newComponentDraft(),
                        ])
                      }
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add component
                    </Button>
                  </div>
                  {scheduleError.includes('needs both') ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                      {scheduleError}
                    </p>
                  ) : null}

                  {componentDrafts.length ? (
                    <div className="divide-y border-y">
                      {componentDrafts.map((component, index) => (
                        <div key={component.key} className="space-y-3 py-4">
                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1">
                              <Field label={`Component ${index + 1}`}>
                                <Input
                                  required
                                  value={component.name}
                                  onChange={(event) =>
                                    setComponentDrafts((value) =>
                                      value.map((item) =>
                                        item.key === component.key
                                          ? { ...item, name: event.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  placeholder="Turbo pump"
                                />
                              </Field>
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              title={`Remove ${component.name || `component ${index + 1}`}`}
                              onClick={() =>
                                setComponentDrafts((value) =>
                                  value.filter(
                                    (item) => item.key !== component.key
                                  )
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Last maintenance">
                              <Input
                                type="datetime-local"
                                value={component.lastMaintenanceAt}
                                onChange={(event) =>
                                  setComponentDrafts((value) =>
                                    value.map((item) =>
                                      item.key === component.key
                                        ? {
                                            ...item,
                                            lastMaintenanceAt: event.target.value,
                                          }
                                        : item
                                    )
                                  )
                                }
                              />
                            </Field>
                            <Field label="Next maintenance">
                              <Input
                                type="datetime-local"
                                value={component.nextMaintenanceAt}
                                onChange={(event) =>
                                  setComponentDrafts((value) =>
                                    value.map((item) =>
                                      item.key === component.key
                                        ? {
                                            ...item,
                                            nextMaintenanceAt: event.target.value,
                                          }
                                        : item
                                    )
                                  )
                                }
                              />
                            </Field>
                            <Field label="Repeat every (months)">
                              <Input
                                min="1"
                                step="1"
                                type="number"
                                value={component.maintenanceIntervalMonths}
                                onChange={(event) =>
                                  setComponentDrafts((value) =>
                                    value.map((item) =>
                                      item.key === component.key
                                        ? {
                                            ...item,
                                            maintenanceIntervalMonths:
                                              event.target.value,
                                          }
                                        : item
                                    )
                                  )
                                }
                                placeholder="6"
                              />
                            </Field>
                          </div>
                          <Field label="Maintenance notes">
                            <Input
                              value={component.notes}
                              onChange={(event) =>
                                setComponentDrafts((value) =>
                                  value.map((item) =>
                                    item.key === component.key
                                      ? { ...item, notes: event.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="Inspection or replacement instructions"
                            />
                          </Field>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="border-y py-5 text-center text-[11px] text-muted-foreground">
                      No components recorded yet.
                    </p>
                  )}
                  </EditorSection>
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 px-5 py-4 pr-16 backdrop-blur sm:flex-nowrap sm:pr-5">
                {editingAsset ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-950/30"
                    disabled={deleteMutation.isPending}
                    onClick={requestAssetDelete}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setEditorOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    'Saving…'
                  ) : (
                    <>
                      <span className="sm:hidden">Save</span>
                      <span className="hidden sm:inline">Save equipment</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function BackupsView({ backups }: { backups: BackupRecord[] }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b p-panel">
        <h2 className="text-sm font-semibold">Backup register</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Database, document, configuration, and instrument backup evidence.
        </p>
      </div>
      {backups.length ? (
        <div className="divide-y">
          {backups.map((backup) => (
            <article
              key={backup.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <HardDrive className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{backup.system_name}</h3>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {backup.destination ?? 'No destination recorded'} ·{' '}
                  {backup.backup_type}
                </p>
              </div>
              <div className="sm:ml-auto sm:text-right">
                <StatusPill tone={statusTone(backup.status)}>
                  {backup.status}
                </StatusPill>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {formatSimpleDate(backup.started_at)}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No backup evidence"
          description="No backup records are currently available."
        />
      )}
    </section>
  );
}
