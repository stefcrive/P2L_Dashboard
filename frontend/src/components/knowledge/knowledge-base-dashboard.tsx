'use client';

import {
  Activity,
  AlertTriangle,
  BookOpenText,
  BrainCircuit,
  ChevronDown,
  ClipboardCheck,
  Database,
  ExternalLink,
  FileSpreadsheet,
  FileSearch,
  FileText,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { MarkdownResponse } from '@/components/chat/markdown-response';
import { KnowledgeReviewQueue } from '@/components/knowledge/knowledge-review-queue';
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

type Tab = 'ask' | 'processing' | 'review' | 'library';
type IngestionMode = 'parse_only' | 'indexed' | 'enriched';

interface Job {
  id: string;
  status:
    | 'queued'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
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
  chunk_target_tokens: number;
  chunk_overlap_tokens: number;
  files: JobFile[];
}

interface JobFile {
  id: string;
  job_id: string;
  source_name: string;
  status: string;
  stage: string;
  message_count: number;
  chunk_count: number;
  embedded_chunks: number;
  warning_count: number;
  error: string | null;
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
  sourceId: number;
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
  parse: 'Extract',
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

function money(value: number) {
  if (value < 0.01) return `<$0.01`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function approximateTokens(files: File[]) {
  return Math.ceil(files.reduce((total, file) => total + file.size, 0) / 4);
}

function embeddingCost(
  tokens: number,
  target: number,
  overlap: number,
  model: string
) {
  const overlapFactor = target > overlap ? target / (target - overlap) : 1;
  const rate = model === 'text-embedding-3-large' ? 0.13 : 0.02;
  return ((tokens * overlapFactor) / 1_000_000) * rate;
}

function groupedJobs(jobs: Job[]) {
  const groups = new Map<string, { job: Job; repeated: number }>();
  for (const job of jobs) {
    const key = [
      job.source_path,
      job.mode,
      job.enrichment_model ?? '',
      job.embedding_model ?? '',
      job.chunk_target_tokens,
      job.chunk_overlap_tokens,
    ].join('::');
    const current = groups.get(key);
    if (current) current.repeated += 1;
    else groups.set(key, { job, repeated: 1 });
  }
  return Array.from(groups.values());
}

function compactPath(value: string) {
  const parts = value.split('\\').join('/').split('/');
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : value;
}

function statusTone(status: string) {
  if (['completed', 'indexed'].includes(status)) return 'success' as const;
  if (['running', 'queued', 'processing'].includes(status))
    return 'primary' as const;
  if (['warning', 'paused'].includes(status)) return 'warning' as const;
  if (['failed', 'cancelled'].includes(status)) return 'danger' as const;
  return 'neutral' as const;
}

function ProvenanceRail({ job }: { job: Job }) {
  const current =
    job.stage === 'complete'
      ? stageOrder.length
      : stageOrder.indexOf(job.stage);
  return (
    <div
      className="grid grid-cols-5 gap-1"
      aria-label={`Current stage: ${job.stage}`}
    >
      {stageOrder.map((stage, index) => {
        const skipped =
          (job.mode === 'parse_only' && ['enrich', 'embed'].includes(stage)) ||
          (job.mode === 'indexed' && stage === 'enrich');
        const complete = job.status === 'completed' || index < current;
        const active =
          !skipped && index === current && job.status === 'running';
        return (
          <div key={stage} className="min-w-0">
            <div
              className={cn(
                'h-1.5 rounded-full bg-slate-200 dark:bg-slate-800',
                complete && !skipped && 'bg-emerald-500 dark:bg-emerald-500',
                active && 'animate-pulse bg-blue-500',
                skipped && 'bg-slate-100 dark:bg-slate-900'
              )}
            />
            <p
              className={cn(
                'mt-1 truncate font-mono text-[9px] uppercase text-muted-foreground',
                active && 'text-primary',
                skipped && 'line-through opacity-50'
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
    throw new Error(
      payload?.error ?? `Request failed with status ${response.status}.`
    );
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
  const [embeddingModel, setEmbeddingModel] = useState(
    'text-embedding-3-small'
  );
  const [chunkTarget, setChunkTarget] = useState(600);
  const [chunkOverlap, setChunkOverlap] = useState(90);
  const [creatingJob, setCreatingJob] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [autoStart, setAutoStart] = useState(true);
  const [question, setQuestion] = useState('');
  const [answerModel, setAnswerModel] = useState('gpt-5.6-terra');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const stepping = useRef(false);
  const defaultsApplied = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await responseJson<Overview>(
        await fetch('/api/knowledge/overview', { cache: 'no-store' })
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
      setPageError(
        error instanceof Error
          ? error.message
          : 'Unable to load knowledge base.'
      );
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
    () =>
      overview?.jobs.find((job) => job.status === 'running') ??
      overview?.jobs.find((job) => job.status === 'queued') ??
      null,
    [overview?.jobs]
  );

  const runNextStep = useCallback(
    async (job: Job) => {
      if (stepping.current) return;
      stepping.current = true;
      setIsStepping(true);
      setActionError('');
      try {
        await responseJson(
          await fetch(`/api/knowledge/jobs/${job.id}/step`, { method: 'POST' })
        );
      } catch (error) {
        setAutoRun(false);
        setActionError(
          error instanceof Error ? error.message : 'Ingestion step failed.'
        );
      } finally {
        stepping.current = false;
        setIsStepping(false);
        await loadOverview(true);
      }
    },
    [loadOverview]
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
      const includesImages = selectedFiles.some((file) =>
        /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
      );
      if (includesImages && !overview?.database.openAIConfigured) {
        throw new Error(
          'Add OPENAI_API_KEY to extract searchable text and visual evidence from images.'
        );
      }
      if (mode !== 'parse_only' && !overview?.database.openAIConfigured) {
        throw new Error(
          'Add OPENAI_API_KEY to the project environment, or choose Extract only.'
        );
      }
      let requestedSourcePath = sourcePath;
      if (selectedFiles.length) {
        setUploading(true);
        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append('files', file));
        const upload = await responseJson<{ sourcePath: string }>(
          await fetch('/api/knowledge/uploads', {
            method: 'POST',
            body: formData,
          })
        );
        requestedSourcePath = upload.sourcePath;
      }
      await responseJson(
        await fetch('/api/knowledge/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourcePath: requestedSourcePath,
            mode,
            enrichmentModel,
            embeddingModel,
            chunkTargetTokens: chunkTarget,
            chunkOverlapTokens: chunkOverlap,
          }),
        })
      );
      setSelectedFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      setTab('processing');
      setAutoRun(autoStart);
      await loadOverview(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to start ingestion.'
      );
    } finally {
      setUploading(false);
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
        })
      );
      if (action !== 'resume') setAutoRun(false);
      await loadOverview(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to update job.'
      );
    }
  }

  async function removeSource(source: Source) {
    if (
      !window.confirm(
        `Remove the indexed copy of "${source.source_name}"?\n\nThe raw source file will not be deleted.`
      )
    ) {
      return;
    }
    setActionError('');
    try {
      await responseJson(
        await fetch(`/api/knowledge/sources/${source.id}`, { method: 'DELETE' })
      );
      await loadOverview(true);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to remove source.'
      );
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
          await fetch(
            `/api/knowledge/search?q=${encodeURIComponent(question)}`,
            {
              cache: 'no-store',
            }
          )
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
          })
        )
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to answer question.'
      );
    } finally {
      setAsking(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <Loader2
          className="h-6 w-6 animate-spin text-primary"
          aria-label="Loading"
        />
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
  const visibleJobs = groupedJobs(data.jobs);
  const selectedTokens = approximateTokens(selectedFiles);
  const selectedEmbeddingCost = embeddingCost(
    selectedTokens,
    chunkTarget,
    chunkOverlap,
    embeddingModel
  );
  const selectedEnrichmentCost =
    (selectedTokens / 1_000_000) * 0.2 +
    ((selectedTokens * 0.1) / 1_000_000) * 1.2;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Laboratory knowledge base"
        description="Add laboratory documents, follow extraction and indexing, then ask questions against readable source evidence."
        actions={
          <div className="flex items-center gap-2">
            <StatusPill
              tone={data.database.openAIConfigured ? 'success' : 'warning'}
            >
              {data.database.openAIConfigured ? 'LLM ready' : 'API key missing'}
            </StatusPill>
            <StatusPill tone="special">Supabase portable</StatusPill>
          </div>
        }
      />

      <div className="flex gap-1 overflow-x-auto rounded-lg border bg-slate-50 p-1 dark:bg-slate-900/70">
        {(
          [
            ['ask', BrainCircuit, 'Ask with evidence'],
            ['processing', Activity, 'Processing'],
            ['review', ClipboardCheck, 'Review queue'],
            ['library', Database, 'Stored sources'],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? 'page' : undefined}
            className={cn(
              'flex h-9 min-w-[120px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-xs font-semibold text-muted-foreground transition-colors',
              tab === value &&
                'bg-background text-foreground shadow-sm ring-1 ring-border'
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
                    <option value="gpt-5.6-terra">
                      GPT-5.6 Terra · balanced
                    </option>
                    <option value="gpt-5.6-sol">
                      GPT-5.6 Sol · highest reasoning
                    </option>
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
                  <StatusPill
                    tone={answer.meta.abstained ? 'warning' : 'success'}
                  >
                    {answer.meta.abstained ? 'Abstained' : 'Grounded answer'}
                  </StatusPill>
                  {answer.meta.refined ? (
                    <StatusPill tone="special">
                      Retrieval refined once
                    </StatusPill>
                  ) : null}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    retrieval {answer.meta.retrievalMs} ms · generation{' '}
                    {answer.meta.generationMs} ms
                  </span>
                </div>
                <MarkdownResponse content={answer.answer} className="text-sm" />
                {answer.meta.invalidCitations?.length ? (
                  <p className="text-xs text-destructive">
                    Citation validation flagged:{' '}
                    {answer.meta.invalidCitations.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-slate-50/60 px-5 py-8 text-center dark:bg-slate-900/30">
                <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">
                  Evidence appears here
                </p>
                <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted-foreground">
                  Answers cite stable chunk IDs. If the archive cannot support a
                  claim, the system is instructed to say so.
                </p>
              </div>
            )}
          </SectionPanel>

          <SectionPanel
            title="Retrieved evidence"
            description={
              answer
                ? `${answer.evidence.length} passages supplied to the model`
                : 'No retrieval yet'
            }
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
                      <div className="flex items-center gap-2">
                        {item.rerankScore !== undefined ? (
                          <span className="font-mono text-[9px] text-muted-foreground">
                            relevance {Math.round(item.rerankScore * 100)}%
                          </span>
                        ) : null}
                        <a
                          href={`/api/knowledge/sources/${item.sourceId}/content`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Open source
                          <ExternalLink
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        </a>
                      </div>
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-xs font-semibold">
                      {item.subject || '(no subject)'}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                      {item.sourceName} · lines {item.startLine}–{item.endLine}
                    </p>
                  </div>
                  <div
                    className="max-h-72 overflow-y-auto overscroll-contain px-3 py-2"
                    tabIndex={0}
                    aria-label={`Full retrieved passage from ${item.sourceName}`}
                  >
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                      {item.content}
                    </p>
                  </div>
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
        <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
          <SectionPanel
            title="Add documents"
            description="Upload a batch, choose how deeply to process it, and add it to the knowledge base."
          >
            <form onSubmit={startJob} className="space-y-4">
              <label
                className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-slate-50/60 px-5 py-6 text-center transition-colors hover:border-primary/60 hover:bg-blue-50/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25 dark:bg-slate-900/30 dark:hover:bg-blue-950/20"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setSelectedFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.tsv,.xls,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                  className="sr-only"
                  onChange={(event) =>
                    setSelectedFiles(Array.from(event.target.files ?? []))
                  }
                />
                <UploadCloud
                  className="h-5 w-5 text-primary"
                  aria-hidden="true"
                />
                <span className="mt-2 text-sm font-semibold">
                  Choose documents or drop them here
                </span>
                <span className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Documents, spreadsheets, PDFs, and images · up to 50 files
                </span>
              </label>

              {selectedFiles.length ? (
                <div className="max-h-36 space-y-1 overflow-y-auto border-y py-2">
                  {selectedFiles.map((file, index) => {
                    const DocumentIcon = /\.(?:csv|tsv|xls|xlsx)$/i.test(file.name)
                      ? FileSpreadsheet
                      : /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
                        ? FileSearch
                        : FileText;
                    return (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className="flex items-center gap-2 py-1 text-xs"
                      >
                        <DocumentIcon
                          className="h-3.5 w-3.5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {bytes(file.size)}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-slate-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-slate-800"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setSelectedFiles((files) =>
                              files.filter(
                                (_, fileIndex) => fileIndex !== index
                              )
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <details className="group border-b pb-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold">
                  Use a workspace file or folder instead
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                </summary>
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[11px] text-muted-foreground">
                    Path inside this project
                  </span>
                  <Input
                    value={sourcePath}
                    onChange={(event) => setSourcePath(event.target.value)}
                  />
                </label>
              </details>

              <label className="block">
                <span className="mb-1.5 block font-mono text-[10px] uppercase text-muted-foreground">
                  Processing depth
                </span>
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as IngestionMode)
                  }
                  className={selectClass}
                >
                  <option value="parse_only">
                    Extract only · no API usage
                  </option>
                  <option value="indexed">
                    Searchable · extract + embeddings
                  </option>
                  <option value="enriched">
                    Enriched · metadata + embeddings
                  </option>
                </select>
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  Searchable is the recommended baseline. Enrichment adds
                  derived tags and summaries for discovery; answers still cite
                  the source text.
                </p>
              </label>

              {mode === 'enriched' ? (
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1 font-mono text-[10px] uppercase text-violet-700 dark:text-violet-300">
                    <Sparkles className="h-3 w-3" /> High-volume enrichment
                    model
                  </span>
                  <select
                    value={enrichmentModel}
                    onChange={(event) => setEnrichmentModel(event.target.value)}
                    className={selectClass}
                  >
                    <option value="gpt-5.6-luna">
                      GPT-5.6 Luna · high volume
                    </option>
                    <option value="gpt-5.6-terra">
                      GPT-5.6 Terra · balanced
                    </option>
                    <option value="gpt-5.6-sol">
                      GPT-5.6 Sol · quality first
                    </option>
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
                    <option value="text-embedding-3-small">
                      text-embedding-3-small · economical
                    </option>
                    <option value="text-embedding-3-large">
                      text-embedding-3-large · higher quality
                    </option>
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
                    onChange={(event) =>
                      setChunkTarget(Number(event.target.value))
                    }
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
                    onChange={(event) =>
                      setChunkOverlap(Number(event.target.value))
                    }
                  />
                </label>
              </div>

              {selectedFiles.length ? (
                <div className="border-y py-3 text-[11px] leading-5 text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Approximate source volume</span>
                    <span className="font-mono text-foreground">
                      {number(selectedTokens)} tokens
                    </span>
                  </div>
                  {mode !== 'parse_only' ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>Estimated embedding cost</span>
                      <span className="font-mono text-foreground">
                        {money(selectedEmbeddingCost)}
                      </span>
                    </div>
                  ) : null}
                  {mode === 'enriched' && enrichmentModel === 'gpt-5.6-luna' ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>Estimated Luna enrichment</span>
                      <span className="font-mono text-foreground">
                        {money(selectedEnrichmentCost)}
                      </span>
                    </div>
                  ) : null}
                  <p className="mt-1">
                    Indicative only: compressed PDFs and spreadsheets can differ
                    substantially after extraction.
                  </p>
                </div>
              ) : null}

              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(event) => setAutoStart(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                />
                <span>
                  <span className="block font-semibold">
                    Start processing immediately
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                    Turn this off to inspect the queued batch before it starts.
                  </span>
                </span>
              </label>

              <Button
                type="submit"
                className="w-full"
                disabled={creatingJob || (!selectedFiles.length && !sourcePath)}
              >
                {creatingJob ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-2 h-3.5 w-3.5" />
                )}
                {uploading
                  ? 'Uploading documents…'
                  : creatingJob
                    ? 'Adding batch…'
                    : 'Add to knowledge base'}
              </Button>
            </form>
          </SectionPanel>

          <SectionPanel
            title="Processing jobs"
            description="Each file is extracted, cleaned, optionally enriched, embedded, and indexed. Open a job to inspect every file."
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
                      Process next file
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
                      {autoRun ? 'Stop processing' : 'Process queue'}
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadOverview(true)}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            }
            bodyClassName="p-0"
          >
            {visibleJobs.length ? (
              visibleJobs.map(({ job, repeated }) => {
                const settled =
                  Number(job.processed_files) +
                  Number(job.skipped_files) +
                  Number(job.failed_files);
                const progress = job.total_files
                  ? Math.round((settled / Number(job.total_files)) * 100)
                  : 0;
                return (
                  <article
                    key={job.id}
                    className="border-b p-4 last:border-b-0"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-sm font-semibold">
                            Job #{job.id}
                          </h3>
                          <StatusPill tone={statusTone(job.status)}>
                            {job.status}
                          </StatusPill>
                          <StatusPill
                            tone={
                              job.mode === 'enriched' ? 'special' : 'neutral'
                            }
                          >
                            {job.mode.replace('_', ' ')}
                          </StatusPill>
                          {repeated > 1 ? (
                            <StatusPill tone="warning">
                              repeated {repeated} times
                            </StatusPill>
                          ) : null}
                        </div>
                        <p
                          className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                          title={job.source_path}
                        >
                          {compactPath(job.source_path)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {['queued', 'running'].includes(job.status) ? (
                          <Button
                            size="icon"
                            variant="outline"
                            title="Pause after current file"
                            onClick={() => void controlJob(job, 'pause')}
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {job.status === 'paused' ? (
                          <Button
                            size="icon"
                            variant="outline"
                            title="Resume"
                            onClick={() => void controlJob(job, 'resume')}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {['queued', 'running', 'paused'].includes(
                          job.status
                        ) ? (
                          <Button
                            size="icon"
                            variant="outline"
                            title="Cancel after current file"
                            onClick={() => void controlJob(job, 'cancel')}
                          >
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
                      <span>
                        {settled}/{job.total_files} files · {progress}%
                      </span>
                      <span>
                        {number(job.embedded_chunks)}/{number(job.total_chunks)}{' '}
                        embeddings
                      </span>
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
                    {job.files.length ? (
                      <details className="group mt-3 border-t pt-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold">
                          <span>
                            {job.files.length}{' '}
                            {job.files.length === 1 ? 'file' : 'files'} in this
                            batch
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mt-2 max-h-56 divide-y overflow-y-auto">
                          {job.files.map((file) => (
                            <div key={file.id} className="py-2 text-[11px]">
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate font-medium">
                                  {file.source_name}
                                </span>
                                <StatusPill tone={statusTone(file.status)}>
                                  {file.status === 'running'
                                    ? file.stage
                                    : file.status}
                                </StatusPill>
                              </div>
                              <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                                {number(file.chunk_count)} chunks ·{' '}
                                {number(file.embedded_chunks)} embeddings
                                {Number(file.warning_count)
                                  ? ` · ${file.warning_count} warnings`
                                  : ''}
                              </p>
                              {file.error ? (
                                <p className="mt-1 text-rose-700 dark:text-rose-300">
                                  {file.error}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <EmptyState
                title="No processing jobs"
                description="Upload documents on the left to create the first batch. Processing progress will appear here."
              />
            )}
          </SectionPanel>
        </div>
      ) : null}

      {tab === 'review' ? (
        <KnowledgeReviewQueue onAddDocuments={() => setTab('processing')} />
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
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      <div className="flex items-start gap-2">
                        <BookOpenText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <a
                            href={`/api/knowledge/sources/${source.id}/content`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="truncate">
                              {source.source_name}
                            </span>
                            <ExternalLink
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                          </a>
                          <p
                            className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground"
                            title={source.source_path}
                          >
                            {source.source_path}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(source.status)}>
                        {source.status}
                      </StatusPill>
                      {Number(source.warning_count) ? (
                        <span className="ml-1.5 text-[10px] text-warning">
                          {source.warning_count} warnings
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {number(source.message_count)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {number(source.chunk_count)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {bytes(Number(source.byte_size))}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {source.sha256.slice(0, 12)}…
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center">
                        <Button asChild size="icon" variant="ghost">
                          <a
                            href={`/api/knowledge/sources/${source.id}/content`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open original source"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Remove indexed copy"
                          onClick={() => void removeSource(source)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-4">
              <EmptyState
                title="The knowledge store is empty"
                description="Add a searchable document batch to populate the local knowledge database."
                action={
                  <Button onClick={() => setTab('processing')}>
                    <FileSearch className="mr-2 h-3.5 w-3.5" />
                    Add documents
                  </Button>
                }
              />
            </div>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
