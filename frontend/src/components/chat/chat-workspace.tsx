'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  History,
  Menu,
  MessageSquareText,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessage } from '@/components/chat/chat-message';
import {
  sendAssistantMessage,
  useAssistantChatStore,
} from '@/lib/assistant/chat-store';

const suggestions = [
  {
    title: 'Operations brief',
    prompt: 'Create an executive report of everything that needs attention.',
  },
  {
    title: 'Inventory review',
    prompt: 'Review inventory and report low-stock consumables with recommended actions.',
  },
  {
    title: 'Client review',
    prompt: 'Summarize client activity, credit balances, results, and open invoices.',
  },
  {
    title: 'Maintenance check',
    prompt: 'Which equipment or lab-book items are due for attention?',
  },
  {
    title: 'Knowledge-base RAG',
    prompt: '/knowledge How should I troubleshoot an IRMS leak?',
  },
];

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ChatWorkspace() {
  const [historyOpen, setHistoryOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydrate = useAssistantChatStore((state) => state.hydrate);
  const hydrated = useAssistantChatStore((state) => state.hydrated);
  const conversations = useAssistantChatStore((state) => state.conversations);
  const activeConversationId = useAssistantChatStore(
    (state) => state.activeConversationId
  );
  const pendingConversationIds = useAssistantChatStore(
    (state) => state.pendingConversationIds
  );
  const errors = useAssistantChatStore((state) => state.errors);
  const createConversation = useAssistantChatStore(
    (state) => state.createConversation
  );
  const selectConversation = useAssistantChatStore(
    (state) => state.selectConversation
  );
  const removeAllConversations = useAssistantChatStore(
    (state) => state.removeAllConversations
  );

  useEffect(() => hydrate(), [hydrate]);

  const conversation = useMemo(
    () =>
      conversations.find((item) => item.id === activeConversationId) ??
      conversations[0],
    [activeConversationId, conversations]
  );
  const pending = conversation
    ? pendingConversationIds.includes(conversation.id)
    : false;
  const error = conversation ? errors[conversation.id] : '';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, error, pending]);

  function chooseConversation(id: string) {
    selectConversation(id);
    if (window.matchMedia('(max-width: 767px)').matches) setHistoryOpen(false);
  }

  return (
    <div className="min-h-[560px]">
      <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[560px] max-w-[1280px] flex-col overflow-hidden rounded-lg border border-slate-200 border-t-2 border-t-sky-500 bg-white shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:border-t-sky-500 dark:bg-slate-950">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((current) => !current)}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-600 dark:border-slate-800 dark:text-slate-300 dark:hover:border-sky-800 dark:hover:text-sky-400"
            >
              <Menu className="h-3.5 w-3.5" />
              History
            </button>
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400 sm:inline">
              P2L / Operations intelligence
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden text-xs font-medium text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 sm:inline"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => createConversation()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-sky-500"
            >
              <Plus className="h-3.5 w-3.5" />
              New chat
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {historyOpen ? (
            <button
              type="button"
              aria-label="Close history"
              onClick={() => setHistoryOpen(false)}
              className="absolute inset-0 z-30 bg-slate-950/35 backdrop-blur-[1px] md:hidden"
            />
          ) : null}

          <aside
            className={`absolute inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 transition-transform dark:border-slate-800 dark:bg-slate-900 md:static md:z-auto xl:w-72 ${
              historyOpen
                ? 'translate-x-0'
                : '-translate-x-full md:hidden md:translate-x-0'
            }`}
          >
            <div className="flex h-11 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <History className="h-3.5 w-3.5 text-slate-400" />
                Conversations
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100 md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!hydrated ? (
                <p className="p-2 text-xs text-slate-400">Loading history…</p>
              ) : null}
              {conversations.map((item) => {
                const selected = item.id === conversation?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseConversation(item.id)}
                    className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/70 dark:text-sky-100'
                        : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <MessageSquareText
                        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                          selected ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{item.title}</p>
                        <p
                          className={`mt-1 font-mono text-[9px] uppercase tracking-wider ${
                            selected
                              ? 'text-sky-600/80 dark:text-sky-400/80'
                              : 'text-slate-400'
                          }`}
                        >
                          {formatHistoryDate(item.updatedAt)} · {item.messages.length}{' '}
                          messages
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-200 p-2 dark:border-slate-800">
              <button
                type="button"
                onClick={() => removeAllConversations()}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[11px] font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear all history
              </button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-slate-950">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 sm:px-8">
                {conversation?.messages.length ? (
                  <div className="py-2">
                    {conversation.messages.map((message) => (
                      <ChatMessage key={message.id} message={message} />
                    ))}
                  </div>
                ) : (
                  <div className="m-auto w-full max-w-2xl py-12 text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-400">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                      What would you like to review?
                    </h1>
                    <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400">
                      Ask across clients, documents, inventory, results, finance, equipment,
                      lab records, and backups. Explicit requests can update stored data;
                      begin with <span className="font-mono text-sky-600 dark:text-sky-400">/knowledge</span> for grounded RAG search.
                    </p>
                    <div className="mx-auto mt-7 overflow-hidden rounded-lg border border-slate-200 text-left dark:border-slate-800">
                      {suggestions.map((suggestion) => (
                        <button
                          key={suggestion.title}
                          type="button"
                          onClick={() =>
                            void sendAssistantMessage(
                              suggestion.prompt,
                              conversation?.id
                            )
                          }
                          className="group flex w-full items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                        >
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block text-left text-sm font-semibold text-slate-800 group-hover:text-sky-600 dark:text-slate-200 dark:group-hover:text-sky-400">
                              {suggestion.title}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                              {suggestion.prompt}
                            </span>
                          </span>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 group-hover:text-sky-500 dark:text-slate-700" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {pending ? (
                  <div className="border-b border-slate-200 py-5 dark:border-slate-800">
                    <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Assistant
                    </p>
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600 dark:border-slate-700 dark:border-t-sky-400" />
                      Reviewing platform data…
                    </div>
                  </div>
                ) : null}
                {error ? (
                  <div
                    role="alert"
                    className="my-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
                  >
                    {error}
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </div>

            <footer className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="mx-auto w-full max-w-4xl">
                <ChatComposer
                  pending={pending}
                  onSend={(message, files) =>
                    sendAssistantMessage(message, conversation?.id, files)
                  }
                />
                <p className="-mt-2 pb-3 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-600">
                  Reads platform data · Writes only on explicit request
                </p>
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
