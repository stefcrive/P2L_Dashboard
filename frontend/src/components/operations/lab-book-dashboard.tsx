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
  notes: string | null;
  provider: Provider | null;
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
    color: 'bg-violet-500',
    icon: BookMarked,
  },
  masters_delivery: {
    label: 'MSc delivery',
    short: 'MSc',
    color: 'bg-sky-500',
    icon: GraduationCap,
  },
  phd_delivery: {
    label: 'PhD delivery',
    short: 'PhD',
    color: 'bg-indigo-500',
    icon: ScrollText,
  },
  results_delivery: {
    label: 'Results delivery',
    short: 'Results',
    color: 'bg-emerald-500',
    icon: FlaskConical,
  },
  maintenance: {
    label: 'Maintenance',
    short: 'Maintenance',
    color: 'bg-amber-500',
    icon: Wrench,
  },
  calibration: {
    label: 'Calibration',
    short: 'Calibration',
    color: 'bg-cyan-500',
    icon: Gauge,
  },
  incident: {
    label: 'Technical issue',
    short: 'Issue',
    color: 'bg-rose-500',
    icon: AlertTriangle,
  },
  quality_control: {
    label: 'Quality control',
    short: 'Quality',
    color: 'bg-teal-500',
    icon: ShieldCheck,
  },
  software: {
    label: 'Software',
    short: 'Software',
    color: 'bg-blue-500',
    icon: Monitor,
  },
  infrastructure: {
    label: 'Infrastructure',
    short: 'Infrastructure',
    color: 'bg-orange-500',
    icon: Zap,
  },
  general: {
    label: 'General note',
    short: 'Note',
    color: 'bg-slate-400',
    icon: FileText,
  },
};

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
  const [editingEntry, setEditingEntry] = useState<LabEntry | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [message, setMessage] = useState('');

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
  const providers = providersQuery.data ?? [];
  const backups = backupsQuery.data ?? [];
  const databaseError =
    (entriesQuery.error as Error | null)?.message ??
    (assetsQuery.error as Error | null)?.message ??
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

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const visible = entries.filter((entry) => {
      if (academicEntryTypes.includes(entry.entry_type)) return false;
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
      if (sortKey === 'type') return entryTypeMeta[entry.entry_type].label;
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
    <div className="mx-auto max-w-[1760px] space-y-5">
      <header className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">
            P2L scientific record
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-[-0.025em]">
            Lab book
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Results, interventions, scholarly output, equipment, and backup
            evidence.
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
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
              'relative flex h-10 items-center gap-2 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground',
              activeView === value &&
                'text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-cyan-500'
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {activeView === 'records' ? (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 lg:mr-auto">
                <h2 className="text-sm font-semibold">Chronological record</h2>
                <p className="text-[11px] text-muted-foreground">
                  {filteredEntries.length.toLocaleString('en-US')} matching
                  records · click a row to inspect or edit
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
            <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-[180px_150px_120px_auto_1fr]">
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
          {pagedEntries.length ? (
            <div className="overflow-x-auto">
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
                    const meta = entryTypeMeta[entry.entry_type];
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={entry.id}
                        onClick={() => openEdit(entry)}
                        className="group cursor-pointer align-top transition-colors hover:bg-cyan-50/50 dark:hover:bg-cyan-950/15"
                      >
                        <td className="relative px-4 py-3.5 pl-6 font-mono text-[11px] font-medium tabular-nums whitespace-nowrap">
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
                        <td className="max-w-[520px] px-3 py-3.5">
                          <p className="font-semibold leading-5 text-foreground">
                            {entry.title}
                          </p>
                          {entry.description ? (
                            <p className="mt-1 line-clamp-2 max-w-[70ch] text-[11px] leading-4 text-muted-foreground">
                              {entry.description}
                            </p>
                          ) : null}
                          {entry.source_reference ? (
                            <p className="mt-1.5 truncate font-mono text-[9px] text-slate-400">
                              SOURCE · {entry.source_reference}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3.5">
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
                        <td className="px-3 py-3.5">
                          <p className="font-medium">
                            {entry.subject ??
                              entry.project_reference ??
                              entry.asset?.asset_code ??
                              '—'}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {entry.project_reference && entry.subject
                              ? entry.project_reference
                              : (entry.institution ??
                                entry.asset?.name ??
                                entry.material ??
                                '')}
                          </p>
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono font-semibold tabular-nums">
                          {entry.quantity === null
                            ? '—'
                            : entry.quantity.toLocaleString('en-US')}
                        </td>
                        <td className="px-3 py-3.5">
                          <StatusPill tone={statusTone(entry.status)}>
                            {statusLabel(entry)}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          <Pencil className="ml-auto h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-cyan-600" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No matching records"
              description="Change the search or filters, or add a new lab-book record."
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
        <EquipmentView assets={assets} providers={providers} />
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

              <div className="space-y-5 p-5">
                {editingEntry?.source_key ? (
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
                        <option value="failed">Failed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Title">
                    <Input
                      required
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
              </div>

              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">
                {editingEntry ? (
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
      entryTypeMeta[entry.entry_type].label,
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
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
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
            <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
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
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
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
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
          {title}
        </h3>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
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

function EquipmentView({
  assets,
  providers,
}: {
  assets: Asset[];
  providers: Provider[];
}) {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [message, setMessage] = useState('');
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
    notes: '',
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (editingAsset)
        return updateResource('assets', editingAsset.id, payload);
      return createResource('assets', payload);
    },
    onSuccess: async () => {
      setMessage(editingAsset ? 'Equipment updated.' : 'Equipment added.');
      setEditorOpen(false);
      setEditingAsset(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'assets'] }),
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
      notes: '',
    };
  }

  function openNewAsset() {
    setEditingAsset(null);
    setDraft(blankAsset());
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
      notes: asset.notes ?? '',
    });
    setMessage('');
    setEditorOpen(true);
  }

  function saveAsset(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate({
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
      notes: draft.notes.trim() || null,
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
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
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
                  <span className="font-mono text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
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
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-[11px]">
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
            className="h-full w-full max-w-xl overflow-y-auto border-l bg-background shadow-2xl"
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

              <div className="space-y-5 p-5">
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
                  <div className="grid grid-cols-2 gap-3">
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
                  </div>
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
              </div>

              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 px-5 py-4 backdrop-blur">
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
                  {saveMutation.isPending ? 'Saving…' : 'Save equipment'}
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
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="border-b px-4 py-3">
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
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
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
