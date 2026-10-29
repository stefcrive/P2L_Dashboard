'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  MessageSquare,
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

const compactSuggestions = [
  'Summarize anything that needs attention',
  'Which consumables are low on stock?',
  '/knowledge How should I troubleshoot an IRMS leak?',
];

export function TradingChatAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const hydrate = useAssistantChatStore((state) => state.hydrate);
  const conversations = useAssistantChatStore((state) => state.conversations);
  const activeConversationId = useAssistantChatStore(
    (state) => state.activeConversationId
  );
  const pendingConversationIds = useAssistantChatStore(
    (state) => state.pendingConversationIds
  );
  const errors = useAssistantChatStore((state) => state.errors);
  const clearConversation = useAssistantChatStore(
    (state) => state.clearConversation
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
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, error, open, pending]);

  if (pathname === '/assistant' || pathname === '/knowledge') return null;

  return (
    <>
      {open ? (
        <section
          aria-label="P2L Assistant"
          className="fixed inset-2 z-[90] flex flex-col overflow-hidden rounded-lg border border-slate-200 border-t-2 border-t-sky-500 bg-white shadow-2xl shadow-slate-950/30 dark:border-slate-800 dark:border-t-sky-500 dark:bg-slate-950 sm:inset-auto sm:bottom-20 sm:right-5 sm:h-[min(650px,calc(100dvh-6rem))] sm:w-[420px]"
        >
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="relative flex h-5 w-5 items-center justify-center rounded-md bg-primary text-white">
                <Sparkles className="h-3 w-3" />
              </span>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Assistant
              </h2>
            </div>
            <div className="flex items-center gap-0.5">
              <Link
                href="/knowledge"
                aria-label="Open full-page assistant"
                title="Open full page"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => conversation && clearConversation(conversation.id)}
                aria-label="Clear current conversation"
                title="Clear conversation"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                title="Close"
                className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            {conversation?.messages.length ? (
              conversation.messages.map((message) => (
                <ChatMessage key={message.id} message={message} compact />
              ))
            ) : (
              <div className="flex min-h-full flex-col justify-center py-8">
                <Sparkles className="mb-3 h-5 w-5 text-primary" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  Review the lab from here
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-slate-500 dark:text-slate-400">
                  Ask for a record, update a field, adjust stock, or prepare a report.
                </p>
                <div className="mt-5 border-y border-slate-200 dark:border-slate-800">
                  {compactSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() =>
                        void sendAssistantMessage(suggestion, conversation?.id)
                      }
                      className="flex w-full items-center justify-between border-b border-slate-200 py-2.5 text-left text-[12px] text-slate-700 last:border-b-0 hover:text-primary dark:border-slate-800 dark:text-slate-300 dark:hover:text-primary"
                    >
                      {suggestion}
                      <span aria-hidden className="text-slate-300 dark:text-slate-700">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pending ? (
              <div className="border-b border-slate-200 py-3.5 dark:border-slate-800">
                <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Assistant
                </p>
                <div className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600 dark:border-slate-700 dark:border-t-sky-400" />
                  Reviewing platform data…
                </div>
              </div>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="my-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-5 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300"
              >
                {error}
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <ChatComposer
              compact
              pending={pending}
              onSend={(message, files) =>
                sendAssistantMessage(message, conversation?.id, files)
              }
            />
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
        className={`fixed bottom-5 right-5 grid h-11 w-11 place-items-center rounded-full text-white shadow-xl shadow-slate-950/30 transition-transform hover:scale-105 ${
          open
            ? 'z-[89] bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600'
            : 'z-[90] bg-primary hover:bg-primary/90'
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
        {!open ? (
          <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-950" />
        ) : null}
      </button>
    </>
  );
}
