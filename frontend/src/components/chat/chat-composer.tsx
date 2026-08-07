'use client';

import { type KeyboardEvent, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { cn } from '@/lib/utils';

export function ChatComposer({
  onSend,
  pending,
  compact = false,
}: {
  onSend: (message: string) => void | Promise<void>;
  pending: boolean;
  compact?: boolean;
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const message = value.trim();
    if (!message || pending) return;
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = '';
    void onSend(message);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className={cn('flex items-end gap-2', compact ? 'p-2.5' : 'p-4')}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          event.currentTarget.style.height = 'auto';
          event.currentTarget.style.height = `${Math.min(
            event.currentTarget.scrollHeight,
            compact ? 112 : 160
          )}px`;
        }}
        onKeyDown={onKeyDown}
        placeholder="Ask about clients, stock, results, invoices…"
        aria-label="Message the assistant"
        className={cn(
          'min-h-9 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500',
          compact ? 'max-h-28 text-[13px]' : 'max-h-40 text-sm'
        )}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!value.trim() || pending}
        aria-label={pending ? 'Assistant is working' : 'Send message'}
        className={cn(
          'grid shrink-0 place-items-center rounded-lg bg-sky-600 text-white shadow-sm hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45',
          compact ? 'h-9 w-9' : 'h-10 w-10'
        )}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
