'use client';

import { Database, FileImage, FileText } from 'lucide-react';

import { MarkdownResponse } from '@/components/chat/markdown-response';
import type { AssistantMessage } from '@/lib/assistant/chat-store';
import { cn } from '@/lib/utils';

export function ChatMessage({
  message,
  compact = false,
}: {
  message: AssistantMessage;
  compact?: boolean;
}) {
  return (
    <article
      className={cn(
        'border-b border-slate-200 py-5 last:border-b-0 dark:border-slate-800',
        compact && 'py-3.5'
      )}
    >
      <p className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {message.role === 'user' ? 'You' : 'Assistant'}
      </p>
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
                      className="inline-flex min-w-0 items-center gap-1 border-l border-slate-200 pl-2 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                      title={`Stored in ${attachment.clientName}`}
                    >
                      <Database className="h-3 w-3 shrink-0" />
                      <span className="max-w-32 truncate">{attachment.clientName}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {message.role === 'assistant' ? (
          <MarkdownResponse
            content={message.content}
            className={compact ? 'text-[13px]' : 'text-sm'}
          />
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
