'use client';

import {
  BrainCircuit,
  Database,
  ExternalLink,
  FileImage,
  FileText,
} from 'lucide-react';

import { MarkdownResponse } from '@/components/chat/markdown-response';
import { KnowledgeAgentTrace } from '@/components/knowledge/knowledge-agent-trace';
import type { AssistantMessage } from '@/lib/assistant/chat-store';
import { cn } from '@/lib/utils';

export function ChatMessage({
  message,
  compact = false,
}: {
  message: AssistantMessage;
  compact?: boolean;
}) {
  const citedVisuals =
    message.role === 'assistant'
      ? (message.evidence ?? []).filter(
          (item) =>
            item.visual && message.content.includes(`[KB:${item.chunkId}]`)
        )
      : [];
  return (
    <article
      className={cn(
        'border-b border-slate-200 py-5 last:border-b-0 dark:border-slate-800',
        compact && 'py-3.5'
      )}
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <p className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          {message.role === 'user' ? 'You' : 'Assistant'}
        </p>
        {message.role === 'user' && message.knowledgeEngineNames?.length ? (
          <span
            className="inline-flex min-w-0 items-center gap-1 truncate rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[9px] text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300"
            title={`Knowledge scope: ${message.knowledgeEngineNames.join(', ')}`}
          >
            <Database className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">
              {message.knowledgeEngineNames.join(' + ')}
            </span>
          </span>
        ) : null}
        {message.role === 'user' && message.thinking ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[9px] text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300">
            <BrainCircuit className="h-2.5 w-2.5" />
            Thinking
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          message.role === 'user' &&
            'border-l-2 border-slate-300 pl-3 dark:border-slate-700'
        )}
      >
        {message.attachments?.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((attachment, index) => {
              const Icon = attachment.type.startsWith('image/')
                ? FileImage
                : FileText;
              return (
                <div
                  key={`${attachment.documentId ?? attachment.uploadId ?? attachment.name}-${index}`}
                  className="flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                  <span className="max-w-52 truncate font-medium">
                    {attachment.name}
                  </span>
                  {attachment.clientName ? (
                    <span
                      className="inline-flex min-w-0 items-center gap-1 border-l border-slate-200 pl-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                      title={`Stored in ${attachment.clientName}`}
                    >
                      <Database className="h-3 w-3 shrink-0" />
                      <span className="max-w-32 truncate">
                        {attachment.clientName}
                      </span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {message.role === 'assistant' ? (
          <>
            <MarkdownResponse
              content={message.content}
              evidence={message.evidence}
              className={compact ? 'text-[13px]' : 'text-sm'}
            />
            {message.trace ? (
              <KnowledgeAgentTrace trace={message.trace} />
            ) : null}
            {citedVisuals.length ? (
              <section
                className="mt-4 grid gap-3 sm:grid-cols-2"
                aria-label="Cited visual evidence"
              >
                {citedVisuals.map((item) => {
                  const visual = item.visual!;
                  return (
                    <figure
                      key={`${item.chunkId}-${visual.id}`}
                      className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"
                    >
                      <a
                        href={visual.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="relative block bg-slate-100 dark:bg-slate-900"
                        title={`Open ${item.sourceName}, page ${visual.pageNumber}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={visual.imageUrl}
                          alt={visual.altText}
                          loading="lazy"
                          className="h-48 w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
                        />
                        <span className="absolute left-2 top-2 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-white">
                          {visual.kind} · p. {visual.pageNumber}
                        </span>
                      </a>
                      <figcaption className="border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                            {visual.caption || visual.altText}
                          </p>
                          <a
                            href={`/knowledge/passages/${item.chunkId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-sky-600 hover:text-sky-500 dark:text-sky-400"
                            aria-label={`Open evidence KB:${item.chunkId}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        <p className="mt-1 truncate font-mono text-[9px] text-slate-400">
                          [KB:{item.chunkId}] {item.sourceName}
                        </p>
                      </figcaption>
                    </figure>
                  );
                })}
              </section>
            ) : null}
          </>
        ) : (
          <p
            className={cn(
              'whitespace-pre-wrap leading-6 text-slate-800 dark:text-slate-200',
              compact ? 'text-[13px]' : 'text-sm'
            )}
          >
            {message.content}
          </p>
        )}
      </div>
    </article>
  );
}
