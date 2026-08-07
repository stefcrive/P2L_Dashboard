'use client';

import {
  Activity,
  AlertTriangle,
  BookOpenText,
  BrainCircuit,
  Database,
  FileSearch,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { MarkdownResponse } from '@/components/chat/markdown-response';
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

type Tab = 'ask' | 'processing' | 'library';
type IngestionMode = 'parse_only' | 'indexed' | 'enriched';

interface Job {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  mode: IngestionMode;
  source_path: string;
  enrichment_model: string | null;
  embedding_model: string | null;
  total_files: number;
  processed_files: number;
  skipped_files: number;
  failed_files: number;
  total_messages: number;
  total_chunks: number;
  embedded_chunks: number;
  current_file: string | null;
  last_error: string | null;
  created_at: string;
  heartbeat_at: string | null;
  finished_at: string | null;
}

interface Source {
  id: string;
  source_name: string;
  source_path: string;
  sha256: string;
  byte_size: number;
  status: string;
  message_count: number;
  chunk_count: number;
  warning_count: number;
  modified_at: string | null;
  updated_at: string;
  metadata: Record<string, unknown>;
}

interface Overview {
  database: {
    engine: string;
    path: string;
    portableTarget: string;
    openAIConfigured: boolean;
  };
  counts: {
    sources: number;
    messages: number;
    chunks: number;
    embeddedChunks: number;
    activeJobs: number;
  };
  jobs: Job[];
  sources: Source[];
  defaults: {
    sourcePath: string;
    enrichmentModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
    answerModel: string;
  };
}

interface Evidence {
  chunkId: number;
  sourceName: string;
  sourcePath: string;
  subject: string;
  author: string;
  messageDate: string | null;
  startLine: number;
  endLine: number;
  content: string;
  semanticRank: number | null;
  keywordRank: number | null;
  exactRank: number | null;
  rrfScore: number;
  rerankScore?: number;
  metadata: Record<string, unknown>;
}

interface AnswerResult {
  answer: string;
  evidence: Evidence[];
  meta: {
    abstained: boolean;
    refined: boolean;
    refinementQuery: string;
    retrievalMs: number;
    generationMs: number;
    citationCount?: number;
    invalidCitations?: number[];
  };
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25';
const stageOrder = ['parse', 'clean', 'enrich', 'embed', 'index'];
const stageLabels: Record<string, string> = {
  parse: 'Parse',
  clean: 'Clean',
  enrich: 'Enrich',
  embed: 'Embed',
  index: 'Index',
};

function number(value: number | undefined) {
  return new Intl.NumberFormat('en-GB').format(Number(value ?? 0));
}

function bytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function compactPath(value: string) {
  const parts = value.split('\\').join('/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : value;
}

function statusTone(status: string) {
  if (['completed', 'indexed'].includes(status)) return 'success' as const;
  if (['running', 'queued', 'processing'].includes(status)) return 'primary' as const;
  if (['warning', 'paused'].includes(status)) return 'warning' as const;
  if (['failed', 'cancelled'].includes(status)) return 'danger' as const;
  return 'neutral' as const;
}

function ProvenanceRail({ job }: { job: Job }) {
  const current = job.stage === 'complete' ? stageOrder.length : stageOrder.indexOf(job.stage);
  return (
    <div className="grid grid-cols-5 gap-1" aria-label={`Current stage: ${job.stage}`}>
      {stageOrder.map((stage, index) => {
        const skipped =
          (job.mode === 'parse_only' && ['enrich', 'embed'].includes(stage)) ||
          (job.mode === 'indexed' && stage === 'enrich');
        const complete = job.status === 'completed' || index < current;
        const active = !skipped && index === current && job.status === 'running';
        return (
          <div key={stage} className="min-w-0">
            <div
              className={cn(
                'h-1.5 rounded-full bg-slate-200 dark:bg-slate-800',
                complete && !skipped && 'bg-emerald-500 dark:bg-emerald-500',
                active && 'animate-pulse bg-blue-500',
                skipped && 'bg-slate-100 dark:bg-slate-900',
              )}
            />
            <p
              className={cn(
                'mt-1 truncate font-mono text-[9px] uppercase text-muted-foreground',
                active && 'text-primary',
                skipped && 'line-through opacity-50',
              )}
            >
              {stageLabels[stage]}
            </p>
          </div>
        );
      })}
    </div>
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

export function KnowledgeBaseDashboard() {
  const [tab, setTab] = useState<Tab>('ask');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [mode, setMode] = useState<IngestionMode>('indexed');
  const [enrichmentModel, setEnrichmentModel] = useState('gpt-5.6-luna');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [chunkTarget, setChunkTarget] = useState(600);
  const [chunkOverlap, setChunkOverlap] = useState(90);
  const [creatingJob, setCreatingJob] = useState(false);
  const [question, setQuestion] = useState('');
  const [answerModel, setAnswerModel] = useState('gpt-5.6-terra');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const stepping = useRef(false);
  const defaultsApplied = useRef(false);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await responseJson<Overview>(
        await fetch('/api/knowledge/overview', { cache: 'no-store' }),
      );
      setOverview(data);
      setPageError('');
      if (!defaultsApplied.current) {
        setSourcePath(data.defaults.sourcePath);
        setEnrichmentModel(data.defaults.enrichmentModel);
        setEmbeddingModel(data.defaults.embeddingModel);
        setAnswerModel(data.defaults.answerModel);
        defaultsApplied.current = true;
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load knowledge base.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const timer = window.setInterval(() => void loadOverview(true), 4_000);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const activeJob = useMemo(
    () => overview?.jobs.find((job) => ['queued', 'running'].includes(job.status)) ?? null,
    [overview?.jobs],
  );

  const runNextStep = useCallback(
    async (job: Job) => {
      if (stepping.current) return;
      stepping.current = true;
      setIsStepping(true);
      setActionError('');
      try {
        await responseJson(
          await fetch(`/api/knowledge/jobs/${job.id}/step`, { method: 'POST' }),
        );
      } catch (error) {
        setAutoRun(false);
        setActionError(error instanceof Error ? error.message : 'Ingestion step failed.');
      } finally {
        stepping.current = false;
        setIsStepping(false);
        await loadOverview(true);
      }
    },
    [loadOverview],
  );

  useEffect(() => {
    if (!autoRun || !activeJob || stepping.current) return;
    const timer = window.setTimeout(() => void runNextStep(activeJob), 750);
    return () => window.clearTimeout(timer);
  }, [
    activeJob,
    autoRun,
    runNextStep,
    activeJob?.processed_files,
    activeJob?.skipped_files,
    activeJob?.failed_files,
  ]);

  async function startJob(event: FormEvent) {
    event.preventDefault();
    setCreatingJob(true);
    setActionError('');
    try {
      await responseJson(
        await fetch('/api/knowledge/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourcePath,
            mode,
            enrichmentModel,
            embeddingModel,
            chunkTargetTokens: chunkTarget,
            chunkOverlapTokens: chunkOverlap,
          }),
        }),
      );
      setTab('processing');
      setAutoRun(false);
      await loadOverview(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to start ingestion.');
    } finally {
      setCreatingJob(false);
    }
  }

  async function controlJob(job: Job, action: 'pause' | 'resume' | 'cancel') {
    setActionError('');
    try {
      await responseJson(
        await fetch(`/api/knowledge/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }),
      );
      if (action !== 'resume') setAutoRun(false);
      await loadOverview(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update job.');
    }
  }

  async function removeSource(source: Source) {
    if (
      !window.confirm(
        `Remove the indexed copy of "${source.source_name}"?\n\nThe raw source file will not be deleted.`,
      )
    ) {
      return;
    }
    setActionError('');
    try {
      await responseJson(
        await fetch(`/api/knowledge/sources/${source.id}`, { method: 'DELETE' }),
      );
      await loadOverview(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to remove source.');
    }
  }

  async function askQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setActionError('');
    setAnswer(null);
    try {
      if (!data.database.openAIConfigured) {
        const result = await responseJson<{ evidence: Evidence[] }>(
          await fetch(`/api/knowledge/search?q=${encodeURIComponent(question)}`, {
            cache: 'no-store',
          }),
        );
        setAnswer({
          answer:
            'Evidence search completed. Configure `OPENAI_API_KEY` in the project `.env` file and restart the app to enable reranking and a grounded cited answer.',
          evidence: result.evidence,
          meta: {
            abstained: true,
            refined: false,
            refinementQuery: '',
            retrievalMs: 0,
            generationMs: 0,
          },
        });
        return;
      }
      setAnswer(
        await responseJson<AnswerResult>(
          await fetch('/api/knowledge/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, answerModel, rerank: true }),
          }),
        ),
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to answer question.');
    } finally {
      setAsking(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  if (pageError && !overview) {
    return (
      <EmptyState
        error
        title="Knowledge database unavailable"
        description={pageError}
        action={
          <Button variant="outline" onClick={() => void loadOverview()}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const data = overview!;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Evidence console / local"
        title="Laboratory knowledge base"
        description="Turn archived analyst conversations into searchable, versioned evidence. Raw messages remain authoritative; derived summaries only improve discovery."
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={data.database.openAIConfigured ? 'success' : 'warning'}>
              {data.database.openAIConfigured ? 'LLM ready' : 'API key missing'}
            </StatusPill>
            <StatusPill tone="special">Supabase portable</StatusPill>
          </div>
        }
      />

      <div className="flex gap-1 rounded-lg border bg-slate-50 p-1 dark:bg-slate-900/70">
        {([
          ['ask', BrainCircuit, 'Ask with evidence'],
          ['processing', Activity, 'Processing'],
          ['library', Database, 'Stored sources'],
        ] as const).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold text-muted-foreground transition-colors',
              tab === value && 'bg-background text-foreground shadow-sm ring-1 ring-border',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {actionError}
        </div>
      ) : null}

      {tab === 'ask' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
          <SectionPanel
            title="Agentic RAG answer"
            description="Hybrid retrieval → evidence reranking → one optional refinement → grounded response."
            bodyClassName="space-y-4"
          >
            <form onSubmit={askQuestion} className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
                  Technical question
                </span>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={4}
                  maxLength={2_000}
                  placeholder="Example: What troubleshooting sequence was recommended for unstable δ13C values, and which instrument was it for?"
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 shadow-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
                    Answer + rerank model
                  </span>
                  <select
                    value={answerModel}
                    onChange={(event) => setAnswerModel(event.target.value)}
                    className={selectClass}
                  >
                    <option value="gpt-5.6-luna">GPT-5.6 Luna · fastest</option>
                    <option value="gpt-5.6-terra">GPT-5.6 Terra · balanced</option>
                    <option value="gpt-5.6-sol">GPT-5.6 Sol · highest reasoning</option>
                  </select>
                </label>
                <Button type="submit" disabled={asking || !question.trim()}>
                  {asking ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-3.5 w-3.5" />
                  )}
                  {asking
                    ? 'Retrieving evidence…'
                    : data.database.openAIConfigured
                      ? 'Ask knowledge base'
                      : 'Search evidence'}
                </Button>
              </div>
            </form>

            {answer ? (
              <div className="space-y-4 border-t pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={answer.meta.abstained ? 'warning' : 'success'}>
                    {answer.meta.abstained ? 'Abstained' : 'Grounded answer'}
                  </StatusPill>
                  {answer.meta.refined ? (
                    <StatusPill tone="special">Retrieval refined once</StatusPill>
                  ) : null}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    retrieval {answer.meta.retrievalMs} ms · generation {answer.meta.generationMs} ms
                  </span>
                </div>
                <MarkdownResponse content={answer.answer} className="text-sm" />
                {answer.meta.invalidCitations?.length ? (
                  <p className="text-xs text-destructive">
                    Citation validation flagged: {answer.meta.invalidCitations.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-slate-50/60 px-5 py-8 text-center dark:bg-slate-900/30">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">Evidence appears here</p>
                <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                  Answers cite stable chunk IDs. If the archive cannot support a claim, the system is instructed to say so.
                </p>
              </div>
            )}
          </SectionPanel>

          <SectionPanel
            title="Retrieved evidence"
            description={answer ? `${answer.evidence.length} passages supplied to the model` : 'No retrieval yet'}
            bodyClassName="space-y-3"
          >
            {answer?.evidence.length ? (
              answer.evidence.map((item) => (
                <article
                  key={item.chunkId}
                  className="overflow-hidden rounded-lg border bg-slate-50/50 dark:bg-slate-900/30"
                >
                  <div className="border-b px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-semibold text-primary">
                        [KB:{item.chunkId}]
                      </span>
                      {item.rerankScore !== undefined ? (
                        <span className="font-mono text-[9px] text-muted-foreground">
                          relevance {Math.round(item.rerankScore * 100)}%
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-xs font-semibold">
                      {item.subject || '(no subject)'}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                      {item.sourceName} · lines {item.startLine}–{item.endLine}
                    </p>
                  </div>
                  <p className="line-clamp-6 whitespace-pre-line px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    {item.content}
                  </p>
                </article>
              ))
            ) : (
              <EmptyState
                title="No evidence selected"
                description="Ask a question after indexing at least one source with embeddings."
              />
            )}
          </SectionPanel>
        </div>
      ) : null}

      {tab === 'processing' ? (
        <div className="grid gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
          <SectionPanel
            title="Start progressive digestion"
            description="One file is checkpointed per step. Jobs stay queued until you run one step or enable continuous processing."
          >
            <form onSubmit={startJob} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                  Source file or folder
                </span>
                <Input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                  Processing depth
                </span>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as IngestionMode)}
                  className={selectClass}
                >
                  <option value="parse_only">Parse only · no API usage</option>
                  <option value="indexed">Indexed · parse + embeddings</option>
                  <option value="enriched">Enriched · metadata LLM + embeddings</option>
                </select>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Indexed is the recommended baseline. Enrichment is derived metadata and never becomes answer evidence.
                </p>
              </label>

              {mode === 'enriched' ? (
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase text-violet-700 dark:text-violet-300">
                    <Sparkles className="h-3 w-3" /> High-volume enrichment model
                  </span>
                  <select
                    value={enrichmentModel}
                    onChange={(event) => setEnrichmentModel(event.target.value)}
                    className={selectClass}
                  >
                    <option value="gpt-5.6-luna">GPT-5.6 Luna · high volume</option>
                    <option value="gpt-5.6-terra">GPT-5.6 Terra · balanced</option>
                    <option value="gpt-5.6-sol">GPT-5.6 Sol · quality first</option>
                  </select>
                </label>
              ) : null}

              {mode !== 'parse_only' ? (
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                    Embedding model · 1024 dimensions
                  </span>
                  <select
                    value={embeddingModel}
                    onChange={(event) => setEmbeddingModel(event.target.value)}
                    className={selectClass}
                  >
                    <option value="text-embedding-3-small">text-embedding-3-small · economical</option>
                    <option value="text-embedding-3-large">text-embedding-3-large · higher quality</option>
                  </select>
                </label>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                    Target tokens
                  </span>
                  <Input
                    type="number"
                    min={200}
                    max={1600}
                    value={chunkTarget}
                    onChange={(event) => setChunkTarget(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                    Overlap tokens
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={400}
                    value={chunkOverlap}
                    onChange={(event) => setChunkOverlap(Number(event.target.value))}
                  />
                </label>
              </div>
              <Button type="submit" className="w-full" disabled={creatingJob || !sourcePath}>
                {creatingJob ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-2 h-3.5 w-3.5" />
                )}
                Create queued job
              </Button>
            </form>
          </SectionPanel>

          <SectionPanel
            title="Digestion queue"
            description="Stage, file-level progress, volume, warnings, and model choices remain auditable."
            actions={
              <div className="flex flex-wrap gap-2">
                {activeJob ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isStepping || autoRun}
                      onClick={() => void runNextStep(activeJob)}
                    >
                      {isStepping ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Run next file
                    </Button>
                    <Button
                      size="sm"
                      variant={autoRun ? 'destructive' : 'default'}
                      onClick={() => setAutoRun((value) => !value)}
                    >
                      {autoRun ? (
                        <Square className="mr-1.5 h-3.5 w-3.5" />
                      ) : (
                        <Activity className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {autoRun ? 'Stop continuous' : 'Run continuously'}
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => void loadOverview(true)}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            }
            bodyClassName="space-y-3"
          >
            {data.jobs.length ? (
              data.jobs.map((job) => {
                const settled =
                  Number(job.processed_files) +
                  Number(job.skipped_files) +
                  Number(job.failed_files);
                const progress = job.total_files
                  ? Math.round((settled / Number(job.total_files)) * 100)
                  : 0;
                return (
                  <article key={job.id} className="rounded-lg border p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-sm font-semibold">Job #{job.id}</h3>
                          <StatusPill tone={statusTone(job.status)}>{job.status}</StatusPill>
                          <StatusPill tone={job.mode === 'enriched' ? 'special' : 'neutral'}>
                            {job.mode.replace('_', ' ')}
                          </StatusPill>
                        </div>
                        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={job.source_path}>
                          {compactPath(job.source_path)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {['queued', 'running'].includes(job.status) ? (
                          <Button size="icon" variant="outline" title="Pause after current file" onClick={() => void controlJob(job, 'pause')}>
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {job.status === 'paused' ? (
                          <Button size="icon" variant="outline" title="Resume" onClick={() => void controlJob(job, 'resume')}>
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {['queued', 'running', 'paused'].includes(job.status) ? (
                          <Button size="icon" variant="outline" title="Cancel after current file" onClick={() => void controlJob(job, 'cancel')}>
                            <Square className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3">
                      <ProvenanceRail job={job} />
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                      <span>{settled}/{job.total_files} files · {progress}%</span>
                      <span>{number(job.total_messages)} messages · {number(job.total_chunks)} chunks</span>
                    </div>
                    {job.current_file ? (
                      <p className="mt-2 truncate text-xs text-foreground">
                        <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin text-primary" />
                        {job.current_file}
                      </p>
                    ) : null}
                    {job.last_error ? (
                      <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
                        {job.last_error}
                      </p>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <EmptyState
                title="No digestion jobs"
                description="Choose the source folder, processing depth, and model to create the first checkpointed job."
              />
            )}
          </SectionPanel>
        </div>
      ) : null}

      {tab === 'library' ? (
        <SectionPanel
          title="Indexed source versions"
          description="Checksums prevent accidental duplicate ingestion. Replacing a file creates a new version and marks the older one obsolete."
          bodyClassName="p-0"
        >
          {data.sources.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Checksum</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      <div className="flex items-start gap-2">
                        <BookOpenText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{source.source_name}</p>
                          <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground" title={source.source_path}>
                            {source.source_path}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(source.status)}>{source.status}</StatusPill>
                      {Number(source.warning_count) ? (
                        <span className="ml-1.5 text-[10px] text-warning">
                          {source.warning_count} warnings
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{number(source.message_count)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{number(source.chunk_count)}</TableCell>
                    <TableCell className="text-right font-mono">{bytes(Number(source.byte_size))}</TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{source.sha256.slice(0, 12)}…</TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Remove indexed copy"
                        onClick={() => void removeSource(source)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="The knowledge store is empty"
                description="Create an indexed digestion job to populate the local PostgreSQL database."
                action={
                  <Button onClick={() => setTab('processing')}>
                    <FileSearch className="mr-2 h-3.5 w-3.5" />
                    Configure ingestion
                  </Button>
                }
              />
            </div>
          )}
        </SectionPanel>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Raw evidence preserved
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
            Every message keeps its source checksum, original text, author/date fields, character offsets, and source line range.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <FileSearch className="h-3.5 w-3.5 text-primary" />
            Hybrid retrieval
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
            Semantic vectors, weighted PostgreSQL full-text search, and exact identifiers are fused before reranking.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Database className="h-3.5 w-3.5 text-violet-600" />
            Local and portable
          </div>
          <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={data.database.path}>
            {data.database.engine} · {compactPath(data.database.path)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">No Docker service required.</p>
        </div>
      </div>
    </div>
  );
}
