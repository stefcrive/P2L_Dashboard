'use client';

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
