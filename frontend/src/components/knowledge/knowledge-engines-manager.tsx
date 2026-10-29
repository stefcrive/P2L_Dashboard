'use client';

import {
  ChevronDown,
  Database,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Unlink,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import {
  EmptyState,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Engine {
  id: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  system_key: string | null;
  source_count: number;
  enabled_source_count: number;
  message_count: number;
  chunk_count: number;
}

interface EngineSource {
  id: string;
  source_name: string;
  source_path: string;
  status: string;
  message_count: number;
  chunk_count: number;
  warning_count: number;
  byte_size: number;
  engine_id: string | null;
  enabled: boolean | null;
}

async function json<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !data) throw new Error(data?.error ?? 'Request failed.');
  return data;
}

export function KnowledgeEnginesManager() {
  const [engines, setEngines] = useState<Engine[]>([]);
  const [sources, setSources] = useState<EngineSource[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addingSource, setAddingSource] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await json<{ engines: Engine[]; sources: EngineSource[] }>(
        await fetch('/api/knowledge/engines', { cache: 'no-store' })
      );
      setEngines(data.engines);
      setSources(data.sources);
      setError('');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load engines.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const uniqueSources = useMemo(
    () =>
      Array.from(
        new Map(sources.map((source) => [source.id, source])).values()
      ),
    [sources]
  );

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await json(
        await fetch('/api/knowledge/engines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description }),
        })
      );
      setName('');
      setDescription('');
      await load();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Unable to create engine.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateEngine(engine: Engine, enabled: boolean) {
    await json(
      await fetch(`/api/knowledge/engines/${engine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
    );
    await load();
  }

  async function updateMembership(
    engineId: string,
    sourceId: string,
    included: boolean,
    enabled = true
  ) {
    setSaving(true);
    try {
      await json(
        await fetch(`/api/knowledge/engines/${engineId}/sources`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, included, enabled }),
        })
      );
      await load();
    } catch (membershipError) {
      setError(
        membershipError instanceof Error
          ? membershipError.message
          : 'Unable to update the engine source.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-workspace">
      <SectionPanel
        title="Create knowledge engine"
        description="Group sources into a domain that can be queried or disabled as one unit. Sources may belong to more than one engine."
      >
        <form
          onSubmit={create}
          className="grid gap-3 md:grid-cols-[minmax(180px,0.55fr)_minmax(0,1fr)_auto] md:items-end"
        >
          <label>
            <span className="mb-1 block text-[11px] font-semibold">
              Engine name
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Instrument manuals"
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-semibold">
              Description
            </span>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What knowledge belongs in this domain?"
            />
          </label>
          <Button type="submit" disabled={!name.trim() || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-2 h-3.5 w-3.5" />
            )}
            Create engine
          </Button>
        </form>
      </SectionPanel>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <SectionPanel
        title="Stored knowledge engines"
        description="Only enabled sources inside enabled engines participate in retrieval. Expand an engine to inspect or change its contents."
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="grid min-h-40 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : engines.length ? (
          <div className="divide-y">
            {engines.map((engine) => {
              const members = sources.filter(
                (source) => source.engine_id === engine.id
              );
              const available = uniqueSources.filter(
                (source) => !members.some((member) => member.id === source.id)
              );
              return (
                <details key={engine.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4">
                    <Database className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-semibold">
                          {engine.name}
                        </span>
                        <a
                          href={`/knowledge/engines/${engine.id}/search`}
                          onClick={(event) => event.stopPropagation()}
                          className="grid h-7 w-7 place-items-center rounded-md border text-primary transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-blue-950/30"
                          title={`Search ${engine.name}`}
                          aria-label={`Search ${engine.name}`}
                        >
                          <Search className="h-3.5 w-3.5" />
                        </a>
                        {engine.system_key ? (
                          <StatusPill tone="special">system engine</StatusPill>
                        ) : null}
                        <StatusPill
                          tone={engine.enabled ? 'success' : 'neutral'}
                        >
                          {engine.enabled ? 'queryable' : 'disabled'}
                        </StatusPill>
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {engine.description || 'No description'} ·{' '}
                        {engine.source_count} sources · {engine.message_count}{' '}
                        messages · {engine.chunk_count} chunks
                      </span>
                    </span>
                    <label
                      className="flex items-center gap-2 text-[11px] font-semibold"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={engine.enabled}
                        onChange={(event) =>
                          void updateEngine(engine, event.target.checked)
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      Query engine
                    </label>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t bg-slate-50/50 px-4 py-4 dark:bg-slate-900/30">
                    {members.length ? (
                      <div className="divide-y border-y">
                        {members.map((source) => (
                          <div
                            key={source.id}
                            className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
                          >
                            <span className="min-w-0 flex-1">
                              <a
                                href={`/api/knowledge/sources/${source.id}/content`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex max-w-full items-center gap-1 text-xs font-semibold text-primary hover:underline"
                              >
                                <span className="truncate">
                                  {source.source_name}
                                </span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              <span className="mt-1 block truncate font-mono text-[9px] text-muted-foreground">
                                {source.source_path} · {source.message_count}{' '}
                                messages · {source.chunk_count} chunks
                              </span>
                            </span>
                            <label className="flex items-center gap-2 text-[11px] font-semibold">
                              <input
                                type="checkbox"
                                checked={Boolean(source.enabled)}
                                onChange={(event) =>
                                  void updateMembership(
                                    engine.id,
                                    source.id,
                                    true,
                                    event.target.checked
                                  )
                                }
                                className="h-4 w-4 accent-primary"
                              />
                              Query source
                            </label>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Remove from this engine"
                              onClick={() =>
                                void updateMembership(
                                  engine.id,
                                  source.id,
                                  false
                                )
                              }
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="py-4 text-xs leading-5 text-muted-foreground">
                        No sources in this engine. Add an indexed source below
                        or target this engine when creating an ingestion job.
                      </p>
                    )}
                    {available.length ? (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          value={addingSource[engine.id] ?? ''}
                          onChange={(event) =>
                            setAddingSource((current) => ({
                              ...current,
                              [engine.id]: event.target.value,
                            }))
                          }
                          className="h-control min-w-0 flex-1 rounded-md border bg-background px-3 text-xs"
                        >
                          <option value="">Add an existing source…</option>
                          {available.map((source) => (
                            <option key={source.id} value={source.id}>
                              {source.source_name}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!addingSource[engine.id] || saving}
                          onClick={() =>
                            void updateMembership(
                              engine.id,
                              addingSource[engine.id],
                              true
                            )
                          }
                        >
                          <Plus className="mr-2 h-3.5 w-3.5" />
                          Add source
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title="No knowledge engines"
              description="Create the first engine to organize indexed sources."
            />
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
