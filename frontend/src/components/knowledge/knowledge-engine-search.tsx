'use client';

import {
  ChevronRight,
  ExternalLink,
  FileSearch,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Engine {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source_count: number;
  chunk_count: number;
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
}

async function json<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? 'Request failed.');
  }
  return payload;
}

export function KnowledgeEngineSearch({ engineId }: { engineId: string }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'text' | 'semantic'>('text');
  const [results, setResults] = useState<Evidence[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingEngine, setLoadingEngine] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  const loadEngine = useCallback(async () => {
    try {
      const data = await json<{ engines: Engine[] }>(
        await fetch('/api/knowledge/engines', { cache: 'no-store' })
      );
      const match = data.engines.find((item) => item.id === engineId) ?? null;
      setEngine(match);
      if (!match) setError('Knowledge engine not found.');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load engine.'
      );
    } finally {
      setLoadingEngine(false);
    }
  }, [engineId]);

  useEffect(() => void loadEngine(), [loadEngine]);

  const selected = useMemo(
    () =>
      results.find((item) => item.chunkId === selectedId) ?? results[0] ?? null,
    [results, selectedId]
  );

  async function searchEngine(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const data = await json<{ evidence: Evidence[] }>(
        await fetch(
          `/api/knowledge/search?q=${encodeURIComponent(query.trim())}&engineId=${encodeURIComponent(engineId)}&mode=${mode}`,
          { cache: 'no-store' }
        )
      );
      setResults(data.evidence);
      setSelectedId(data.evidence[0]?.chunkId ?? null);
      setSearched(true);
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : 'Unable to search this engine.'
      );
    } finally {
      setSearching(false);
    }
  }

  if (loadingEngine) {
    return (
      <div className="grid min-h-[55vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-workspace">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground"
      >
        <Link href="/knowledge" className="hover:text-foreground">
          Knowledge engine
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <Link href="/knowledge?tab=engines" className="hover:text-foreground">
          Engines & sources
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground">
          Search {engine?.name ?? `#${engineId}`}
        </span>
      </nav>

      <PageHeader
        eyebrow="Engine dataset search"
        title={engine?.name ?? 'Knowledge engine'}
        actions={
          engine ? (
            <div className="flex gap-1.5">
              <StatusPill tone={engine.enabled ? 'success' : 'neutral'}>
                {engine.enabled ? 'queryable' : 'engine disabled'}
              </StatusPill>
              <StatusPill tone="primary">
                {engine.source_count} sources · {engine.chunk_count} passages
              </StatusPill>
            </div>
          ) : null
        }
      />

      <Toolbar>
        <form
          onSubmit={searchEngine}
          className="flex flex-col gap-3 lg:flex-row lg:items-end"
        >
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold">
              Search this engine
            </span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={2_000}
                placeholder="Procedure, instrument, fault code, part number…"
                className="pl-9"
              />
            </span>
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-semibold">
              Search method
            </span>
            <div className="flex rounded-md border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setMode('text')}
                aria-pressed={mode === 'text'}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded px-3 text-[11px] font-semibold',
                  mode === 'text' && 'bg-slate-100 shadow-sm dark:bg-slate-800'
                )}
              >
                <FileSearch className="h-3.5 w-3.5" />
                Text
              </button>
              <button
                type="button"
                onClick={() => setMode('semantic')}
                aria-pressed={mode === 'semantic'}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded px-3 text-[11px] font-semibold',
                  mode === 'semantic' &&
                    'bg-violet-50 text-violet-800 shadow-sm dark:bg-violet-950 dark:text-violet-200'
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Semantic
              </button>
            </div>
          </div>
          <Button
            type="submit"
            disabled={!query.trim() || searching || !engine}
          >
            {searching ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="mr-2 h-3.5 w-3.5" />
            )}
            {searching ? 'Searching…' : 'Search engine'}
          </Button>
        </form>
      </Toolbar>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-workspace xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.45fr)]">
        <SectionPanel
          title="Matching passages"
          description={
            searched
              ? `${results.length} results · ${mode} search`
              : 'Run a search to inspect this engine'
          }
          bodyClassName="p-0"
        >
          {results.length ? (
            <div className="max-h-[700px] divide-y overflow-y-auto">
              {results.map((item) => (
                <button
                  key={item.chunkId}
                  type="button"
                  onClick={() => setSelectedId(item.chunkId)}
                  className={cn(
                    'block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-slate-900/60',
                    selected?.chunkId === item.chunkId &&
                      'bg-blue-50/70 dark:bg-blue-950/30'
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] font-semibold text-primary">
                      KB:{item.chunkId}
                    </span>
                    <span className="truncate font-mono text-[9px] text-muted-foreground">
                      {item.sourceName}
                    </span>
                  </span>
                  <span className="mt-2 block line-clamp-2 text-xs font-semibold leading-5">
                    {item.subject || '(no subject)'}
                  </span>
                  <span className="mt-1 block max-h-[3.75rem] overflow-hidden text-[11px] leading-5 text-muted-foreground">
                    {item.content}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title={searched ? 'No matching passages' : 'Search the engine'}
                description={
                  searched
                    ? mode === 'semantic'
                      ? 'Try a broader concept, or use text search for exact terminology.'
                      : 'Try fewer words, a part number, or semantic search for related concepts.'
                    : 'Choose text for exact terminology or semantic for concept-level similarity.'
                }
              />
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          title="Passage"
          description="Inspect the complete retrieved chunk before opening its source document."
          bodyClassName="p-0"
        >
          {selected ? (
            <div>
              <div className="border-b px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/knowledge/passages/${selected.chunkId}`}
                      target="_blank"
                      className="font-mono text-[11px] font-semibold text-primary hover:underline"
                    >
                      [KB:{selected.chunkId}]
                    </Link>
                    <h2 className="mt-2 font-display text-base font-semibold">
                      {selected.subject || '(no subject)'}
                    </h2>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {selected.author || 'Unknown author'} ·{' '}
                      {selected.sourceName} · lines {selected.startLine}–
                      {selected.endLine}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/knowledge/sources/${selected.sourceId}/content`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source
                      <ExternalLink className="ml-2 h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
              <div
                className="max-h-[590px] min-h-72 overflow-y-auto bg-slate-50/50 px-4 py-4 dark:bg-slate-900/30"
                tabIndex={0}
              >
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {selected.content}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title="Select a passage"
                description="Matching passages appear here with their full indexed text and source reference."
              />
            </div>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
