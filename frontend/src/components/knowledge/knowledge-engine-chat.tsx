'use client';

import * as Popover from '@radix-ui/react-popover';
import * as Switch from '@radix-ui/react-switch';
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Database,
  ExternalLink,
  History,
  Loader2,
  Menu,
  MessageSquareText,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessage } from '@/components/chat/chat-message';
import { EmptyState } from '@/components/dashboard/primitives';
import {
  sendAssistantMessage,
  useAssistantChatStore,
} from '@/lib/assistant/chat-store';

const suggestions = [
  'How should I troubleshoot unstable IRMS measurements?',
  'What leak-detection procedures appear in the active engines?',
  'Summarize recurring calibration problems and their remedies.',
];

const THINKING_MODE_STORAGE_KEY = 'p2l-knowledge-thinking-mode-v1';

function historyDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function KnowledgeEngineChat({
  engines,
  onEnginesChanged,
}: {
  engines: Array<{ id: string; name: string; enabled: boolean }>;
  onEnginesChanged: () => void | Promise<void>;
}) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [activatingEngineId, setActivatingEngineId] = useState<string | null>(
    null
  );
  const [scopeError, setScopeError] = useState('');
  const enabledEngines = useMemo(
    () => engines.filter((engine) => engine.enabled),
    [engines]
  );
  const [selectedEngineIds, setSelectedEngineIds] = useState<string[]>(() =>
    engines.filter((engine) => engine.enabled).map((engine) => engine.id)
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydrate = useAssistantChatStore((state) => state.hydrate);
  const hydrated = useAssistantChatStore((state) => state.hydrated);
  const conversations = useAssistantChatStore((state) => state.conversations);
  const activeId = useAssistantChatStore((state) => state.activeConversationId);
  const pendingIds = useAssistantChatStore(
    (state) => state.pendingConversationIds
  );
  const errors = useAssistantChatStore((state) => state.errors);
  const setError = useAssistantChatStore((state) => state.setError);
  const createConversation = useAssistantChatStore(
    (state) => state.createConversation
  );
  const selectConversation = useAssistantChatStore(
    (state) => state.selectConversation
  );
  const removeAll = useAssistantChatStore(
    (state) => state.removeAllConversations
  );

  useEffect(() => hydrate(), [hydrate]);
  useEffect(() => {
    try {
      setThinkingMode(
        window.localStorage.getItem(THINKING_MODE_STORAGE_KEY) === 'true'
      );
    } catch {
      setThinkingMode(false);
    }
  }, []);
  useEffect(() => {
    const availableIds = new Set(enabledEngines.map((engine) => engine.id));
    setSelectedEngineIds((current) => {
      const retained = current.filter((id) => availableIds.has(id));
      return retained.length
        ? retained
        : enabledEngines.map((engine) => engine.id);
    });
  }, [enabledEngines]);
  const conversation = useMemo(
    () =>
      conversations.find((item) => item.id === activeId) ?? conversations[0],
    [activeId, conversations]
  );
  const pending = conversation ? pendingIds.includes(conversation.id) : false;
  const error = conversation ? errors[conversation.id] : '';
  const pendingThinking = useMemo(
    () =>
      pending &&
      [...(conversation?.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'user')?.thinking === true,
    [conversation?.messages, pending]
  );
  const latestEvidence = useMemo(
    () =>
      [...(conversation?.messages ?? [])]
        .reverse()
        .find(
          (message) => message.role === 'assistant' && message.evidence?.length
        )?.evidence ?? [],
    [conversation?.messages]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, pending, error]);

  function sendKnowledge(message: string, files: File[]) {
    if (!selectedEngineIds.length) {
      if (conversation) {
        setError(
          conversation.id,
          'Select at least one active knowledge engine before asking.'
        );
      }
      return;
    }
    const clean = message.trim();
    const prefixed = /^\/knowledge(?:\s|$)/i.test(clean)
      ? clean
      : `/knowledge ${clean}`;
    const selectedEngines = enabledEngines.filter((engine) =>
      selectedEngineIds.includes(engine.id)
    );
    return sendAssistantMessage(prefixed, conversation?.id, files, {
      knowledgeEngineIds: selectedEngines.map((engine) => engine.id),
      knowledgeEngineNames: selectedEngines.map((engine) => engine.name),
      thinking: thinkingMode,
    });
  }

  function changeThinkingMode(checked: boolean) {
    setThinkingMode(checked);
    try {
      window.localStorage.setItem(
        THINKING_MODE_STORAGE_KEY,
        String(checked)
      );
    } catch {
      // The control still works for this session when storage is unavailable.
    }
  }

  function toggleEngine(engineId: string) {
    setSelectedEngineIds((current) => {
      if (!current.includes(engineId)) return [...current, engineId];
      if (current.length === 1) return current;
      return current.filter((id) => id !== engineId);
    });
  }

  async function enableEngine(engineId: string) {
    setActivatingEngineId(engineId);
    setScopeError('');
    try {
      const response = await fetch(`/api/knowledge/engines/${engineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.error ?? `Request failed with status ${response.status}.`
        );
      }
      setSelectedEngineIds((current) =>
        current.includes(engineId) ? current : [...current, engineId]
      );
      await onEnginesChanged();
    } catch (error) {
      setScopeError(
        error instanceof Error ? error.message : 'Unable to enable this engine.'
      );
    } finally {
      setActivatingEngineId(null);
    }
  }

  const selectedEngines = enabledEngines.filter((engine) =>
    selectedEngineIds.includes(engine.id)
  );
  const scopeLabel = !selectedEngines.length
    ? 'No engine'
    : selectedEngines.length === enabledEngines.length
      ? 'All active'
      : selectedEngines.length === 1
        ? selectedEngines[0].name
        : `${selectedEngines.length} engines`;

  return (
    <section className="relative flex h-[calc(100dvh-13rem)] min-h-[620px] overflow-hidden rounded-lg border bg-card">
      {historyOpen ? (
        <button
          type="button"
          aria-label="Close conversation history"
          onClick={() => setHistoryOpen(false)}
          className="absolute inset-0 z-30 bg-slate-950/35 md:hidden"
        />
      ) : null}
      <aside
        className={`absolute inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r bg-slate-50 transition-transform dark:bg-slate-900 md:static md:z-auto ${
          historyOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b px-3">
          <span className="flex items-center gap-2 text-xs font-semibold">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            Saved conversations
          </span>
          <button
            type="button"
            onClick={() => setHistoryOpen(false)}
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-muted md:hidden"
            aria-label="Close history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!hydrated ? (
            <p className="p-2 text-xs text-muted-foreground">
              Loading history…
            </p>
          ) : null}
          {conversations.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                selectConversation(item.id);
                if (window.matchMedia('(max-width: 767px)').matches) {
                  setHistoryOpen(false);
                }
              }}
              className={`mb-1 w-full rounded-md px-3 py-2.5 text-left ${
                item.id === conversation?.id
                  ? 'bg-blue-50 text-primary dark:bg-blue-950/50'
                  : 'hover:bg-muted'
              }`}
            >
              <span className="flex items-start gap-2">
                <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">
                    {item.title}
                  </span>
                  <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                    {historyDate(item.updatedAt)} · {item.messages.length}{' '}
                    messages
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => removeAll()}
          className="flex h-10 items-center gap-2 border-t px-3 text-[11px] text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear conversation history
        </button>
      </aside>

      <div className="flex min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold"
            >
              <Menu className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">History</span>
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <label
                className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 transition-colors focus-within:ring-2 focus-within:ring-indigo-500/30 ${
                  thinkingMode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200'
                    : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                }`}
                title="Iterate between searching and reviewing evidence before answering"
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                <span className="hidden text-[11px] font-semibold uppercase tracking-[0.1em] lg:inline">
                  Thinking
                </span>
                <Switch.Root
                  checked={thinkingMode}
                  onCheckedChange={changeThinkingMode}
                  aria-label="Thinking mode"
                  className="relative h-4 w-7 rounded-full bg-slate-300 outline-none transition-colors data-[state=checked]:bg-indigo-600 dark:bg-slate-700 dark:data-[state=checked]:bg-indigo-500"
                >
                  <Switch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-3.5" />
                </Switch.Root>
              </label>
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 max-w-[min(48vw,320px)] items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-800 shadow-sm hover:border-sky-300 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-950"
                    aria-label={`Choose knowledge engines. ${scopeLabel} selected.`}
                  >
                    <Database className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden shrink-0 text-[11px] uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400 sm:inline">
                      Scope
                    </span>
                    <span className="truncate">{scopeLabel}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={8}
                    className="z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl outline-none dark:border-slate-700 dark:bg-slate-950"
                  >
                    <div className="border-b border-slate-200 px-3.5 py-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            Knowledge scope
                          </h2>
                          <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                            Choose the engines searched by new questions.
                          </p>
                        </div>
                        {enabledEngines.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedEngineIds(
                                enabledEngines.map((engine) => engine.id)
                              )
                            }
                            className="shrink-0 text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                          >
                            Select all
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {engines.length ? (
                        engines.map((engine) => {
                          const checked = selectedEngineIds.includes(engine.id);
                          const protectsLastSelection =
                            engine.enabled &&
                            checked &&
                            selectedEngineIds.length === 1;
                          if (!engine.enabled) {
                            const activating = activatingEngineId === engine.id;
                            return (
                              <button
                                key={engine.id}
                                type="button"
                                disabled={Boolean(activatingEngineId)}
                                onClick={() => void enableEngine(engine.id)}
                                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-wait disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                              >
                                <span className="grid h-4 w-4 shrink-0 place-items-center rounded border border-dashed border-slate-300 dark:border-slate-600">
                                  {activating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Plus className="h-3 w-3" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {engine.name}
                                </span>
                                <span className="font-mono text-[9px] uppercase tracking-wider text-sky-600 dark:text-sky-400">
                                  Enable
                                </span>
                              </button>
                            );
                          }
                          return (
                            <label
                              key={engine.id}
                              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-900"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={protectsLastSelection}
                                onChange={() => toggleEngine(engine.id)}
                                className="peer sr-only"
                              />
                              <span
                                className={`grid h-4 w-4 shrink-0 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500/40 ${
                                  checked
                                    ? 'border-sky-600 bg-sky-600 text-white'
                                    : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-950'
                                }`}
                                aria-hidden="true"
                              >
                                {checked ? <Check className="h-3 w-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                                {engine.name}
                              </span>
                            </label>
                          );
                        })
                      ) : (
                        <p className="px-2 py-5 text-center text-xs text-slate-500">
                          No knowledge engines are configured.
                        </p>
                      )}
                    </div>
                    {scopeError ? (
                      <p
                        role="alert"
                        className="border-t border-rose-200 bg-rose-50 px-3.5 py-2 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                      >
                        {scopeError}
                      </p>
                    ) : null}
                    <div className="border-t border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-[9px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                      {selectedEngines.length} of {enabledEngines.length} active
                      engines selected
                    </div>
                    <Popover.Arrow className="fill-slate-200 dark:fill-slate-700" />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              <button
                type="button"
                onClick={() => createConversation()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground sm:px-3"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New chat</span>
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-7">
              {conversation?.messages.length ? (
                <div className="py-2">
                  {conversation.messages.map((message) => (
                    <ChatMessage key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <div className="m-auto w-full max-w-xl py-10 text-center">
                  <Search className="mx-auto h-6 w-6 text-primary" />
                  <h1 className="mt-4 font-display text-2xl font-semibold tracking-[-0.02em]">
                    Ask your selected knowledge engines
                  </h1>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                    Responses are saved with the conversation and grounded in
                    enabled sources. Turn on Thinking to search and review in
                    multiple rounds before answering.
                  </p>
                  <div className="mt-6 divide-y overflow-hidden rounded-lg border text-left">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void sendKnowledge(suggestion, [])}
                        className="block w-full px-4 py-3 text-xs hover:bg-muted"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pending ? (
                <p className="border-b py-5 text-sm text-muted-foreground">
                  {pendingThinking
                    ? 'Thinking: searching, reviewing, and following evidence leads…'
                    : 'Retrieving and checking evidence…'}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="my-4 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {latestEvidence.length ? (
                <details className="my-4 rounded-lg border xl:hidden">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                    Retrieved evidence · {latestEvidence.length} passages
                  </summary>
                  <div className="max-h-72 divide-y overflow-y-auto border-t px-3">
                    {latestEvidence.map((item) => (
                      <article key={item.chunkId} className="py-3">
                        <a
                          href={`/knowledge/passages/${item.chunkId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          [KB:{item.chunkId}] {item.subject || item.sourceName}
                        </a>
                        <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                          {item.content}
                        </p>
                        {item.visual ? (
                          <a
                            href={item.visual.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block overflow-hidden rounded-md border bg-muted"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.visual.imageUrl}
                              alt={item.visual.altText}
                              loading="lazy"
                              className="h-36 w-full object-contain"
                            />
                          </a>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </div>
          <footer className="shrink-0 border-t">
            <div className="mx-auto max-w-3xl">
              <ChatComposer
                pending={pending}
                initialValue="/knowledge "
                placeholder="Ask the selected knowledge engines…"
                onSend={sendKnowledge}
              />
            </div>
          </footer>
        </div>

        <aside className="hidden w-[340px] shrink-0 border-l bg-slate-50/60 dark:bg-slate-900/30 xl:flex xl:flex-col">
          <div className="border-b px-4 py-3">
            <h2 className="font-display text-sm font-semibold">
              Retrieved evidence
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {latestEvidence.length
                ? `${latestEvidence.length} passages used by the latest answer`
                : 'Evidence appears here'}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {latestEvidence.length ? (
              latestEvidence.map((item) => (
                <article
                  key={item.chunkId}
                  className="overflow-hidden rounded-lg border bg-card"
                >
                  <div className="border-b px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={`/knowledge/passages/${item.chunkId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] font-semibold text-primary hover:underline"
                      >
                        [KB:{item.chunkId}]
                      </a>
                      <a
                        href={`/api/knowledge/sources/${item.sourceId}/content`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-xs font-semibold">
                      {item.subject || '(no subject)'}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                      {item.sourceName} · lines {item.startLine}–{item.endLine}
                    </p>
                  </div>
                  {item.visual ? (
                    <a
                      href={item.visual.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="relative block border-b bg-slate-100 dark:bg-slate-900"
                      title={`Open original PDF page ${item.visual.pageNumber}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.visual.imageUrl}
                        alt={item.visual.altText}
                        loading="lazy"
                        className="h-44 w-full object-contain"
                      />
                      <span className="absolute bottom-2 left-2 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
                        {item.visual.kind} · page {item.visual.pageNumber}
                      </span>
                    </a>
                  ) : null}
                  <div
                    className="max-h-64 overflow-y-auto px-3 py-2"
                    tabIndex={0}
                  >
                    <p className="whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
                      {item.content}
                    </p>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState
                title="Evidence appears here"
                description="Ask a question to inspect every passage supplied to the answer."
              />
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
