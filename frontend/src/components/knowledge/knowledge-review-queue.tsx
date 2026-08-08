'use client';

import {
  ArchiveX,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSearch,
  Loader2,
  RefreshCw,
  Search,
  SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EmptyState,
  MetricRail,
  MetricTile,
  SectionPanel,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ReviewStatus =
  | 'pending'
  | 'kept'
  | 'quarantined'
  | 'skipped';
type ReviewFilter = ReviewStatus | 'all';

interface ReviewItem {
  id: string;
  message_id: string | null;
  source_id: string | null;
  source_path: string;
  source_name: string;
  source_ordinal: number;
  raw_source_path: string | null;
  raw_start_line: number | null;
  raw_end_line: number | null;
  stable_id: string;
  thread_key: string;
  subject: string;
  author: string;
  message_date: string | null;
  content: string;
  origin: 'ingestion' | 'cleanup_audit';
  status: ReviewStatus;
  reason_codes: string[];
  signals: Record<string, unknown>;
  reviewer_note: string;
  reviewed_at: string | null;
}

interface ReviewStats {
  total: number;
  pending: number;
  kept: number;
  quarantined: number;
  skipped: number;
  human_reviewed: number;
  cleanup_audit: number;
  ingestion: number;
}

interface ReviewQueueResponse {
  items: ReviewItem[];
  filteredTotal: number;
  stats: ReviewStats;
  reasons: Array<{ reason: string; count: number }>;
  limit: number;
  offset: number;
}

interface ReviewDetailResponse {
  item: ReviewItem;
  context: Array<
    Pick<
      ReviewItem,
      'id' | 'subject' | 'author' | 'message_date' | 'content' | 'status'
    >
  >;
}

const PAGE_SIZE = 25;
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25';
const REVIEW_CATEGORIES = [
  {
    reason: 'ambiguous_retained_for_recall',
    label: 'Uncertain retained',
    risk: 'Review before embedding',
    target: 'Resolve all pending',
    description:
      'Currently included for recall, but deterministic signals were inconclusive.',
    tone: 'warning' as const,
  },
  {
    reason: 'empty_after_cleanup',
    label: 'Empty after parsing',
    risk: 'Highest structural risk',
    target: 'Review all',
    description:
      'Inspect the raw source because malformed content may have failed parsing.',
    tone: 'danger' as const,
  },
  {
    reason: 'commercial_posting',
    label: 'Commercial postings',
    risk: 'Moderate',
    target: 'Review all',
    description:
      'May contain useful instrument specifications or technical capabilities.',
    tone: 'warning' as const,
  },
  {
    reason: 'event_announcement',
    label: 'Event announcements',
    risk: 'Moderate',
    target: 'Sample at least 200',
    description:
      'Abstracts and session descriptions can contain useful technical summaries.',
    tone: 'warning' as const,
  },
  {
    reason: 'job_posting',
    label: 'Job postings',
    risk: 'Usually low',
    target: 'Sample at least 200',
    description:
      'Keep only unique instrument, method, or laboratory capability details.',
    tone: 'neutral' as const,
  },
  {
    reason: 'list_administration',
    label: 'List administration',
    risk: 'Low',
    target: 'Sample at least 50',
    description: 'Normally administrative and safe to leave quarantined.',
    tone: 'neutral' as const,
  },
  {
    reason: 'nontechnical_conversation',
    label: 'Nontechnical conversation',
    risk: 'Low · quick review',
    target: 'Review all',
    description: 'Only a small set; review all of them rather than sampling.',
    tone: 'neutral' as const,
  },
];

function statusTone(status: ReviewStatus) {
  if (status === 'kept') return 'success' as const;
  if (status === 'quarantined') return 'danger' as const;
  if (status === 'skipped') return 'neutral' as const;
  return 'warning' as const;
}

function friendlyReason(reason: string) {
  return reason.replace(/^enrichment_/, 'model: ').replace(/_/g, ' ');
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ?? `Request failed with status ${response.status}.`
    );
  }
  return payload;
}

export function KnowledgeReviewQueue({
  onAddDocuments,
}: {
  onAddDocuments: () => void;
}) {
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [status, setStatus] = useState<ReviewFilter>('pending');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState<
    'kept' | 'quarantined' | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search.trim()) params.set('search', search.trim());
      if (reason) params.set('reason', reason);
      const data = await responseJson<ReviewQueueResponse>(
        await fetch(`/api/knowledge/reviews?${params}`, {
          cache: 'no-store',
        })
      );
      setQueue(data);
      setSelectedIds(new Set());
      setSelectedId((current) =>
        current && data.items.some((item) => item.id === current)
          ? current
          : (data.items[0]?.id ?? null)
      );
      setError('');
      return data;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load the review queue.'
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [offset, reason, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQueue(), 250);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    void fetch(`/api/knowledge/reviews/${selectedId}`, { cache: 'no-store' })
      .then((response) => responseJson<ReviewDetailResponse>(response))
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setNote(data.item.reviewer_note ?? '');
      })
      .catch((detailError) => {
        if (active) {
          setError(
            detailError instanceof Error
              ? detailError.message
              : 'Unable to load the selected message.'
          );
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function decide(nextStatus: ReviewStatus) {
    if (!selectedId) return;
    setSaving(true);
    setError('');
    try {
      await responseJson(
        await fetch(`/api/knowledge/reviews/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus, reviewerNote: note }),
        })
      );
      setSelectedId(null);
      setDetail(null);
      await loadQueue();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Unable to save the review decision.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function decideBulk(nextStatus: 'kept' | 'quarantined') {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (
      nextStatus === 'quarantined' &&
      !window.confirm(
        `Quarantine ${ids.length} selected ${ids.length === 1 ? 'message' : 'messages'}? They will be excluded from retrieval and future processing.`
      )
    ) {
      return;
    }
    setBulkSaving(nextStatus);
    setError('');
    try {
      await responseJson(
        await fetch('/api/knowledge/reviews/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids,
            status: nextStatus,
            reviewerNote: reason
              ? `Bulk review: ${friendlyReason(reason)}`
              : 'Bulk decision from review queue',
          }),
        })
      );
      setSelectedIds(new Set());
      setSelectedId(null);
      setDetail(null);
      await loadQueue();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : 'Unable to save the bulk decision.'
      );
    } finally {
      setBulkSaving(null);
    }
  }

  async function importAudit() {
    setImporting(true);
    setError('');
    try {
      await responseJson(
        await fetch('/api/knowledge/reviews/import', { method: 'POST' })
      );
      setStatus('pending');
      setOffset(0);
      await loadQueue();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : 'Unable to import the cleanup audit.'
      );
    } finally {
      setImporting(false);
    }
  }

  const reviewed = useMemo(
    () => Number(queue?.stats.human_reviewed ?? 0),
    [queue]
  );
  const pageEnd = Math.min(
    offset + PAGE_SIZE,
    Number(queue?.filteredTotal ?? 0)
  );
  const pageIds = queue?.items.map((item) => item.id) ?? [];
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const reasonCounts = new Map(
    queue?.reasons.map((item) => [item.reason, Number(item.count)]) ?? []
  );

  if (!loading && queue && Number(queue.stats.total) === 0) {
    return (
      <SectionPanel
        title="Review uncertain content"
        description="Screen ambiguous material before paying to enrich and embed it."
      >
        <EmptyState
          title="No messages need review"
          description="Import the existing cleanup audit, or add new documents with Extract only. Future ingestion automatically sends uncertain messages here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void importAudit()} disabled={importing}>
                {importing ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                )}
                Import cleanup review
              </Button>
              <Button variant="outline" onClick={onAddDocuments}>
                <FileSearch className="mr-2 h-3.5 w-3.5" />
                Add documents
              </Button>
            </div>
          }
        />
      </SectionPanel>
    );
  }

  return (
    <div className="space-y-5">
      <MetricRail className="md:grid-cols-4">
        <MetricTile
          label="Needs decision"
          value={loading && !queue ? '—' : Number(queue?.stats.pending ?? 0)}
          detail="excluded only after quarantine"
          tone="warning"
        />
        <MetricTile
          label="Reviewed"
          value={reviewed}
          detail="decisions made by a reviewer"
          tone="primary"
        />
        <MetricTile
          label="Approved"
          value={Number(queue?.stats.kept ?? 0)}
          detail="kept for retrieval or ingestion"
          tone="success"
        />
        <MetricTile
          label="Quarantined"
          value={Number(queue?.stats.quarantined ?? 0)}
          detail="blocked from retrieval"
          tone="danger"
        />
      </MetricRail>

      <SectionPanel
        title="Review by risk"
        description="Start with content already included in the cleaned corpus, then inspect quarantines where technical information is most likely to have been lost."
        bodyClassName="p-0"
      >
        <div className="divide-y">
          {REVIEW_CATEGORIES.map((category) => {
            const active = reason === category.reason;
            return (
              <button
                key={category.reason}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setReason(active ? '' : category.reason);
                  setStatus(active ? 'pending' : 'all');
                  setOffset(0);
                }}
                className={cn(
                  'grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(180px,0.55fr)_minmax(0,1.45fr)_auto] sm:items-center sm:gap-4 dark:hover:bg-slate-900/60',
                  active && 'bg-blue-50/70 dark:bg-blue-950/30'
                )}
              >
                <span>
                  <span className="block text-xs font-semibold">
                    {category.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {category.target}
                  </span>
                </span>
                <span className="text-[11px] leading-5 text-muted-foreground">
                  {category.description}
                </span>
                <span className="flex items-center gap-2 sm:justify-end">
                  <StatusPill tone={category.tone}>{category.risk}</StatusPill>
                  <span className="min-w-10 text-right font-mono text-xs font-semibold tabular-nums">
                    {reasonCounts.get(category.reason) ?? 0}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SectionPanel>

      <Toolbar>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold">
              Search messages
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
                placeholder="Subject, source, or message text"
                className="pl-9"
              />
            </span>
          </label>
          <label className="w-full lg:w-44">
            <span className="mb-1 block text-[11px] font-semibold">
              Decision
            </span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ReviewFilter);
                setOffset(0);
              }}
              className={selectClass}
            >
              <option value="pending">Needs decision</option>
              <option value="kept">Kept</option>
              <option value="quarantined">Quarantined · reviewable</option>
              <option value="skipped">Skipped</option>
              <option value="all">All decisions</option>
            </select>
          </label>
          <label className="w-full lg:w-52">
            <span className="mb-1 block text-[11px] font-semibold">
              Review reason
            </span>
            <select
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setOffset(0);
              }}
              className={selectClass}
            >
              <option value="">All reasons</option>
              {queue?.reasons.map((item) => (
                <option key={item.reason} value={item.reason}>
                  {friendlyReason(item.reason)} ({item.count})
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void loadQueue()}
              disabled={loading}
            >
              <RefreshCw
                className={cn('mr-2 h-3.5 w-3.5', loading && 'animate-spin')}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => void importAudit()}
              disabled={importing}
            >
              {importing ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Sync audit
            </Button>
          </div>
        </div>
      </Toolbar>

      <div className="flex flex-col gap-3 rounded-lg border bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={allPageSelected}
            onChange={(event) =>
              setSelectedIds(
                event.target.checked ? new Set(pageIds) : new Set()
              )
            }
            disabled={!pageIds.length || loading || Boolean(bulkSaving)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Select this page
          <span className="font-normal text-muted-foreground">
            · {selectedIds.size} selected
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!selectedIds.size || Boolean(bulkSaving)}
            onClick={() => void decideBulk('kept')}
          >
            {bulkSaving === 'kept' ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-2 h-3.5 w-3.5" />
            )}
            Keep selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!selectedIds.size || Boolean(bulkSaving)}
            onClick={() => void decideBulk('quarantined')}
          >
            {bulkSaving === 'quarantined' ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArchiveX className="mr-2 h-3.5 w-3.5" />
            )}
            Quarantine selected
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(290px,0.72fr)_minmax(0,1.45fr)]">
        <SectionPanel
          title="Messages"
          description={
            queue
              ? `${queue.filteredTotal} matching ${queue.filteredTotal === 1 ? 'message' : 'messages'}`
              : 'Loading review queue'
          }
          bodyClassName="p-0"
          actions={
            queue && queue.filteredTotal > PAGE_SIZE ? (
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Previous page"
                  disabled={offset === 0}
                  onClick={() =>
                    setOffset((value) => Math.max(0, value - PAGE_SIZE))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-20 text-center font-mono text-[10px] text-muted-foreground">
                  {offset + 1}–{pageEnd}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Next page"
                  disabled={pageEnd >= queue.filteredTotal}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null
          }
        >
          {loading && !queue ? (
            <div className="grid min-h-56 place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : queue?.items.length ? (
            <div className="max-h-[720px] divide-y overflow-y-auto overscroll-contain">
              {queue.items.map((item) => (
                <article
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60',
                    selectedId === item.id &&
                      'bg-blue-50/70 dark:bg-blue-950/30'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={(event) => {
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
                    aria-label={`Select ${item.subject || 'message'}`}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="min-w-0 flex-1 text-left focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <StatusPill tone={statusTone(item.status)}>
                        {item.status === 'pending'
                          ? 'needs decision'
                          : item.status}
                      </StatusPill>
                      <span className="truncate font-mono text-[9px] text-muted-foreground">
                        {item.source_name}
                      </span>
                    </span>
                    <span className="mt-2 block line-clamp-2 text-xs font-semibold leading-5">
                      {item.subject || '(no subject)'}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {item.content || 'No parsed content · open the raw source'}
                    </span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No matching messages"
                description="Change the filters or search text to inspect another part of the queue."
              />
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          title="Review message"
          description="Read the complete text and its source before deciding whether it belongs in retrieval."
          bodyClassName="p-0"
        >
          {detailLoading ? (
            <div className="grid min-h-[480px] place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : detail ? (
            <div>
              <div className="border-b px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={statusTone(detail.item.status)}>
                        {detail.item.status === 'pending'
                          ? 'needs decision'
                          : detail.item.status}
                      </StatusPill>
                      <StatusPill tone="neutral">
                        {detail.item.origin === 'cleanup_audit'
                          ? 'cleanup audit'
                          : 'new ingestion'}
                      </StatusPill>
                    </div>
                    <h3 className="mt-2 font-display text-base font-semibold leading-6">
                      {detail.item.subject || '(no subject)'}
                    </h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {detail.item.author || 'Unknown author'}
                      {detail.item.message_date
                        ? ` · ${new Date(detail.item.message_date).toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/knowledge/reviews/${detail.item.id}/source`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source text
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
                <p
                  className="mt-3 truncate font-mono text-[9px] text-muted-foreground"
                  title={
                    detail.item.raw_source_path ?? detail.item.source_path
                  }
                >
                  {detail.item.raw_source_path ?? detail.item.source_path}
                  {detail.item.raw_start_line
                    ? ` · raw lines ${detail.item.raw_start_line}–${detail.item.raw_end_line ?? detail.item.raw_start_line}`
                    : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detail.item.reason_codes.map((item) => (
                    <StatusPill key={item} tone="warning">
                      {friendlyReason(item)}
                    </StatusPill>
                  ))}
                </div>
              </div>

              <div
                className="max-h-[430px] min-h-56 overflow-y-auto overscroll-contain border-b bg-slate-50/50 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-slate-900/30"
                tabIndex={0}
                aria-label="Full message content"
              >
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {detail.item.content}
                </p>
              </div>

              {detail.context.length ? (
                <details className="group border-b px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold">
                    <span>
                      Thread context · {detail.context.length}{' '}
                      {detail.context.length === 1 ? 'message' : 'messages'}
                    </span>
                    <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="mt-3 max-h-64 divide-y overflow-y-auto border-y">
                    {detail.context.map((item) => (
                      <article key={item.id} className="py-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11px] font-semibold">
                            {item.author || 'Unknown author'}
                          </p>
                          <StatusPill tone={statusTone(item.status)}>
                            {item.status}
                          </StatusPill>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                          {item.content}
                        </p>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}

              <div className="space-y-3 px-4 py-4">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold">
                    Reviewer note
                  </span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    maxLength={4_000}
                    placeholder="Optional: record why this decision was made"
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-xs leading-5 shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="sm:flex-1"
                    disabled={saving}
                    onClick={() => void decide('kept')}
                  >
                    <Check className="mr-2 h-3.5 w-3.5" />
                    Keep for ingestion
                  </Button>
                  <Button
                    variant="destructive"
                    className="sm:flex-1"
                    disabled={saving}
                    onClick={() => void decide('quarantined')}
                  >
                    <ArchiveX className="mr-2 h-3.5 w-3.5" />
                    Quarantine
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => void decide('skipped')}
                  >
                    <SkipForward className="mr-2 h-3.5 w-3.5" />
                    Decide later
                  </Button>
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  Quarantined messages are removed from retrieval immediately.
                  Changing an audit quarantine to Keep admits it when that raw
                  source is next processed; leaving it quarantined skips it
                  before enrichment and embedding.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title="Select a message"
                description="Choose an item from the list to read the complete text and make a decision."
              />
            </div>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
