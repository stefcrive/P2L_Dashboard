'use client';

import {
  ArchiveX,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSearch,
  Loader2,
  Sparkles,
  Square,
  RefreshCw,
  Search,
  SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  EmptyState,
  SectionPanel,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type ReviewStatus = 'pending' | 'kept' | 'quarantined' | 'skipped';
type ReviewFilter = ReviewStatus | 'all';
type AutoTriageFilter =
  | ''
  | 'untriaged'
  | 'assessed'
  | 'kept'
  | 'quarantined'
  | 'needs_review';

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
  auto_triaged: number;
  auto_kept: number;
  auto_quarantined: number;
  auto_needs_review: number;
  auto_untriaged: number;
}

interface AutoTriageProgress {
  processed: number;
  kept: number;
  quarantined: number;
  needsReview: number;
  remaining: number;
  model: string;
}

interface ReviewJob {
  id: string;
  status: string;
  stage: string;
  source_path: string;
  engine_name: string | null;
  total_files: number;
  created_at: string;
  finished_at: string | null;
  review_count: number;
  pending_count: number;
  kept_count: number;
  quarantined_count: number;
  skipped_count: number;
}

interface ReviewQueueResponse {
  items: ReviewItem[];
  filteredTotal: number;
  stats: ReviewStats;
  reasons: Array<{ reason: string; count: number }>;
  jobs: ReviewJob[];
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
const AUTO_TRIAGE_CALL_SIZE = 16;
const MAX_AUTO_TRIAGE_RUN = 5_000;
const selectClass =
  'h-control w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25';
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
  jobId,
}: {
  onAddDocuments?: () => void;
  jobId?: string;
}) {
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [status, setStatus] = useState<ReviewFilter>('pending');
  const [reason, setReason] = useState('');
  const [autoState, setAutoState] = useState<AutoTriageFilter>('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    jobId ?? null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState<'kept' | 'quarantined' | null>(
    null
  );
  const [importing, setImporting] = useState(false);
  const [autoTriaging, setAutoTriaging] = useState(false);
  const [triageBatchSize, setTriageBatchSize] = useState('16');
  const [triageProgress, setTriageProgress] =
    useState<AutoTriageProgress | null>(null);
  const stopTriage = useRef(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(
    async (options?: { clearError?: boolean }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          status,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (search.trim()) params.set('search', search.trim());
        if (reason) params.set('reason', reason);
        if (autoState) params.set('autoState', autoState);
        if (selectedJobId) params.set('jobId', selectedJobId);
        const data = await responseJson<ReviewQueueResponse>(
          await fetch(`/api/knowledge/reviews?${params}`, {
            cache: 'no-store',
          })
        );
        setQueue(data);
        setSelectedIds(new Set());
        const selectedJobHasPendingReviews =
          selectedJobId === 'all' ||
          !selectedJobId ||
          data.jobs.some((item) => item.id === selectedJobId);
        if (!selectedJobHasPendingReviews) {
          setSelectedJobId(null);
          setSelectedId(null);
          setDetail(null);
        } else {
          setSelectedId((current) =>
            current && data.items.some((item) => item.id === current)
              ? current
              : (data.items[0]?.id ?? null)
          );
        }
        if (options?.clearError !== false) setError('');
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
    },
    [autoState, offset, reason, search, selectedJobId, status]
  );

  useEffect(() => {
    const stored = window.localStorage.getItem('p2l-auto-triage-run-size');
    if (stored && /^\d+$/.test(stored)) setTriageBatchSize(stored);
  }, []);

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
      setAutoState('');
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

  async function runAutoTriage() {
    const batchSize = Math.min(
      MAX_AUTO_TRIAGE_RUN,
      Math.max(1, Math.floor(Number(triageBatchSize) || 16))
    );
    setTriageBatchSize(String(batchSize));
    window.localStorage.setItem('p2l-auto-triage-run-size', String(batchSize));
    stopTriage.current = false;
    setAutoTriaging(true);
    setError('');
    const cumulative: AutoTriageProgress = {
      processed: 0,
      kept: 0,
      quarantined: 0,
      needsReview: 0,
      remaining: Number(queue?.stats.auto_untriaged ?? 0),
      model: 'gpt-5.6-luna',
    };
    setTriageProgress({ ...cumulative });
    try {
      while (!stopTriage.current && cumulative.processed < batchSize) {
        const requested = Math.min(
          AUTO_TRIAGE_CALL_SIZE,
          batchSize - cumulative.processed
        );
        const batch = await responseJson<AutoTriageProgress>(
          await fetch('/api/knowledge/reviews/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              limit: requested,
              jobId:
                selectedJobId && /^\d+$/.test(selectedJobId)
                  ? Number(selectedJobId)
                  : undefined,
            }),
          })
        );
        cumulative.processed += batch.processed;
        cumulative.kept += batch.kept;
        cumulative.quarantined += batch.quarantined;
        cumulative.needsReview += batch.needsReview;
        cumulative.remaining = batch.remaining;
        cumulative.model = batch.model;
        setTriageProgress({ ...cumulative });
        if (!batch.processed || batch.remaining === 0) break;
      }
    } catch (triageError) {
      setError(
        triageError instanceof Error
          ? triageError.message
          : 'Automated triage stopped after an error.'
      );
    } finally {
      setAutoTriaging(false);
      // Refresh the counts without erasing a triage failure that the user
      // still needs to read.
      await loadQueue({ clearError: false });
    }
  }

  const pageEnd = Math.min(
    offset + PAGE_SIZE,
    Number(queue?.filteredTotal ?? 0)
  );
  const pageIds = queue?.items.map((item) => item.id) ?? [];
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedJob = queue?.jobs.find((item) => item.id === selectedJobId);
  const reviewingAll = selectedJobId === 'all';

  function selectJob(nextJobId: string) {
    setSelectedJobId(nextJobId);
    setStatus('pending');
    setReason('');
    setAutoState('');
    setSearch('');
    setOffset(0);
    setSelectedIds(new Set());
    setSelectedId(null);
    setDetail(null);
    setTriageProgress(null);
  }

  if (
    !loading &&
    queue &&
    Number(queue.stats.total) === 0 &&
    queue.jobs.length === 0
  ) {
    return (
      <SectionPanel
        title="Review uncertain content"
        description={
          jobId
            ? 'This job has no unresolved messages blocking embedding.'
            : 'Screen ambiguous material before paying to enrich and embed it.'
        }
      >
        <EmptyState
          title="No messages need review"
          description={
            jobId
              ? 'Return to processing to continue or inspect this job.'
              : 'Import the existing cleanup audit, or add new documents with Extract only. Future ingestion automatically sends uncertain messages here.'
          }
          action={
            jobId ? (
              <Button
                variant="outline"
                onClick={() =>
                  window.location.assign('/knowledge?tab=processing')
                }
              >
                <FileSearch className="mr-2 h-3.5 w-3.5" />
                Back to processing
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => void importAudit()} disabled={importing}>
                  {importing ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  )}
                  Import cleanup review
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    onAddDocuments
                      ? onAddDocuments()
                      : window.location.assign('/knowledge?tab=processing')
                  }
                >
                  <FileSearch className="mr-2 h-3.5 w-3.5" />
                  Add documents
                </Button>
              </div>
            )
          }
        />
      </SectionPanel>
    );
  }

  return (
    <div className="space-y-workspace">
      <SectionPanel
        title="Review jobs"
        description="Jobs with messages still awaiting a review decision. Select a row to load its pending messages and decision panel."
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap gap-2">
            {Number(queue?.stats.cleanup_audit ?? 0) > 0 ? (
              <Button
                size="sm"
                variant={reviewingAll ? 'default' : 'outline'}
                onClick={() => selectJob('all')}
              >
                Review all messages
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadQueue()}
              disabled={loading}
            >
              <RefreshCw
                className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')}
              />
              Refresh jobs
            </Button>
          </div>
        }
      >
        {loading && !queue ? (
          <div className="grid min-h-32 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : queue?.jobs.length ? (
          <Table
            aria-label="Jobs with review messages"
            containerClassName="max-h-80 overscroll-contain"
          >
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Review status</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Review messages</TableHead>
                <TableHead className="text-right">Needs decision</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.jobs.map((reviewJob) => {
                const isSelected = selectedJobId === reviewJob.id;
                return (
                  <TableRow
                    key={reviewJob.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    data-state={isSelected ? 'selected' : undefined}
                    onClick={() => selectJob(reviewJob.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectJob(reviewJob.id);
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <TableCell>
                      <span className="font-mono font-semibold tabular-nums">
                        #{reviewJob.id}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-80">
                      <span
                        className="block truncate font-medium"
                        title={reviewJob.source_path}
                      >
                        {reviewJob.source_path}
                      </span>
                      {reviewJob.engine_name ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {reviewJob.engine_name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone="warning">pending</StatusPill>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(reviewJob.total_files).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(reviewJob.review_count).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusPill
                        tone={
                          Number(reviewJob.pending_count) > 0
                            ? 'warning'
                            : 'success'
                        }
                        className="font-mono tabular-nums"
                      >
                        {Number(reviewJob.pending_count).toLocaleString()}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(reviewJob.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState
              title="No pending review jobs"
              description="Jobs leave this table after every review message has a decision."
            />
          </div>
        )}
      </SectionPanel>

      {!selectedJobId ? (
        <SectionPanel
          title="Messages and decision"
          description="Select a review job above to inspect its messages."
        >
          <EmptyState
            title="Select a review job"
            description="Choose any row in the jobs table to populate the message list and the Keep or Quarantine review panel."
          />
        </SectionPanel>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Reviewing</span>
            <StatusPill tone="primary">
              {reviewingAll ? 'all review messages' : `job #${selectedJobId}`}
            </StatusPill>
            {selectedJob ? (
              <span className="min-w-0 truncate">
                {selectedJob.source_path}
              </span>
            ) : null}
          </div>
          <Toolbar>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[11px] font-semibold">
                  Search messages
                </span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                    setAutoState('');
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
                    className={cn(
                      'mr-2 h-3.5 w-3.5',
                      loading && 'animate-spin'
                    )}
                  />
                  Refresh
                </Button>
                {!jobId ? (
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
                ) : null}
              </div>
            </div>
          </Toolbar>

          <SectionPanel
            title="Automated uncertain-lane triage"
            description="Luna keeps useful technical material, quarantines only high-confidence administrative content, and leaves borderline messages pending. Select an automatic decision count to inspect and override its messages below."
            actions={
              <div className="flex items-end gap-2">
                <label className="w-24">
                  <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Messages this run
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={MAX_AUTO_TRIAGE_RUN}
                    step={1}
                    value={triageBatchSize}
                    disabled={autoTriaging}
                    onChange={(event) => setTriageBatchSize(event.target.value)}
                    onBlur={() => {
                      const normalized = Math.min(
                        MAX_AUTO_TRIAGE_RUN,
                        Math.max(1, Math.floor(Number(triageBatchSize) || 16))
                      );
                      setTriageBatchSize(String(normalized));
                      window.localStorage.setItem(
                        'p2l-auto-triage-run-size',
                        String(normalized)
                      );
                    }}
                    aria-label="Auto-triage batch size"
                    className="h-9 font-mono tabular-nums"
                  />
                </label>
                {autoTriaging ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      stopTriage.current = true;
                    }}
                  >
                    <Square className="mr-2 h-3.5 w-3.5" />
                    Stop after batch
                  </Button>
                ) : (
                  <Button
                    onClick={() => void runAutoTriage()}
                    disabled={!Number(queue?.stats.auto_untriaged ?? 0)}
                  >
                    <Sparkles className="mr-2 h-3.5 w-3.5" />
                    {Number(queue?.stats.auto_untriaged ?? 0)
                      ? 'Run auto-triage'
                      : 'Uncertain lane triaged'}
                  </Button>
                )}
              </div>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                {
                  label: 'Untriaged',
                  value: queue?.stats.auto_untriaged ?? 0,
                  filter: 'untriaged' as AutoTriageFilter,
                },
                {
                  label: 'Model assessed',
                  value: queue?.stats.auto_triaged ?? 0,
                  filter: 'assessed' as AutoTriageFilter,
                },
                {
                  label: 'Auto-kept',
                  value: queue?.stats.auto_kept ?? 0,
                  filter: 'kept' as AutoTriageFilter,
                },
                {
                  label: 'Auto-quarantined',
                  value: queue?.stats.auto_quarantined ?? 0,
                  filter: 'quarantined' as AutoTriageFilter,
                },
                {
                  label: 'Needs human',
                  value: queue?.stats.auto_needs_review ?? 0,
                  filter: 'needs_review' as AutoTriageFilter,
                },
              ].map((card) => {
                const active = autoState === card.filter;
                const content = (
                  <>
                    <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                      {card.label}
                    </p>
                    <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                      {Number(card.value).toLocaleString()}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {active ? 'Showing below' : 'Review messages'}
                    </p>
                  </>
                );
                return (
                  <button
                    key={card.label}
                    type="button"
                    aria-pressed={active}
                    disabled={!Number(card.value)}
                    onClick={() => {
                      const next = active ? '' : card.filter;
                      setAutoState(next);
                      setStatus(
                        next === 'assessed'
                          ? 'all'
                          : next === 'kept' || next === 'quarantined'
                            ? next
                            : 'pending'
                      );
                      setReason('');
                      setSearch('');
                      setOffset(0);
                      setSelectedId(null);
                      setDetail(null);
                    }}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-950/20',
                      active &&
                        'border-primary bg-blue-50 ring-1 ring-primary/20 dark:bg-blue-950/30'
                    )}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
            {triageProgress ? (
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                This run: {triageProgress.processed.toLocaleString()} assessed ·{' '}
                {triageProgress.kept.toLocaleString()} kept ·{' '}
                {triageProgress.quarantined.toLocaleString()} quarantined ·{' '}
                {triageProgress.needsReview.toLocaleString()} sent to human
                review · {triageProgress.remaining.toLocaleString()} remaining ·{' '}
                {triageProgress.model}
                {autoTriaging ? ' · processing next batch…' : ''}
              </p>
            ) : null}
          </SectionPanel>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="grid gap-workspace xl:grid-cols-[minmax(290px,0.72fr)_minmax(0,1.45fr)]">
            <SectionPanel
              title="Messages"
              description={
                queue
                  ? `${queue.filteredTotal} matching ${queue.filteredTotal === 1 ? 'message' : 'messages'}`
                  : 'Loading review queue'
              }
              bodyClassName="p-0"
              actions={
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <label className="mr-1 flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={(event) =>
                        setSelectedIds(
                          event.target.checked ? new Set(pageIds) : new Set()
                        )
                      }
                      disabled={
                        !pageIds.length || loading || Boolean(bulkSaving)
                      }
                      className="h-3.5 w-3.5 rounded border-input accent-primary"
                    />
                    Select page
                    {selectedIds.size ? (
                      <span className="font-mono text-muted-foreground">
                        {selectedIds.size}
                      </span>
                    ) : null}
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    title="Keep selected messages"
                    disabled={!selectedIds.size || Boolean(bulkSaving)}
                    onClick={() => void decideBulk('kept')}
                  >
                    {bulkSaving === 'kept' ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title="Quarantine selected messages"
                    disabled={!selectedIds.size || Boolean(bulkSaving)}
                    onClick={() => void decideBulk('quarantined')}
                  >
                    {bulkSaving === 'quarantined' ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArchiveX className="mr-1.5 h-3.5 w-3.5 text-destructive" />
                    )}
                    Quarantine
                  </Button>
                  {queue && queue.filteredTotal > PAGE_SIZE ? (
                    <>
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
                      <span className="min-w-20 text-center font-mono text-[11px] text-muted-foreground">
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
                    </>
                  ) : null}
                </div>
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
                          {item.content ||
                            'No parsed content · open the raw source'}
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
                    {detail.item.signals.autoTriage &&
                    typeof detail.item.signals.autoTriage === 'object' ? (
                      <div className="mt-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] leading-5 text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
                        <p className="font-semibold">
                          Luna assessment ·{' '}
                          {String(
                            (
                              detail.item.signals.autoTriage as Record<
                                string,
                                unknown
                              >
                            ).classification ?? 'unclear'
                          ).replace(/_/g, ' ')}{' '}
                          ·{' '}
                          {Math.round(
                            Number(
                              (
                                detail.item.signals.autoTriage as Record<
                                  string,
                                  unknown
                                >
                              ).confidence ?? 0
                            ) * 100
                          )}
                          % confidence
                        </p>
                        <p>
                          {String(
                            (
                              detail.item.signals.autoTriage as Record<
                                string,
                                unknown
                              >
                            ).rationale ?? ''
                          )}
                        </p>
                      </div>
                    ) : null}
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
                      Quarantined messages are removed from retrieval
                      immediately. Changing an audit quarantine to Keep admits
                      it when that raw source is next processed; leaving it
                      quarantined skips it before enrichment and embedding.
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
        </>
      )}
    </div>
  );
}
