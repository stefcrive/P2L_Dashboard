'use client';

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from 'react';
import {
  FileImage,
  FileText,
  Loader2,
  Paperclip,
  Send,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const ACCEPTED_FILES = [
  '.pdf',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.xls',
  '.xlsx',
  '.doc',
  '.docx',
  '.rtf',
  '.odt',
  '.ppt',
  '.pptx',
  '.json',
  '.html',
  '.xml',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
].join(',');

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ChatComposer({
  onSend,
  pending,
  compact = false,
  initialValue = '',
  placeholder = 'Ask about operations, attach a file, or use /knowledge…',
}: {
  onSend: (message: string, files: File[]) => void | Promise<void>;
  pending: boolean;
  compact?: boolean;
  initialValue?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(selected: File[]) {
    const next = [...files];
    const known = new Set(next.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of selected) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!known.has(key)) {
        next.push(file);
        known.add(key);
      }
    }
    if (next.length > MAX_FILES) {
      setAttachmentError(`Attach up to ${MAX_FILES} files per message.`);
      return;
    }
    const oversized = next.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setAttachmentError(`${oversized.name} exceeds the 25 MB file limit.`);
      return;
    }
    if (next.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
      setAttachmentError('Attachments exceed the 50 MB combined limit.');
      return;
    }
    setAttachmentError('');
    setFiles(next);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  function submit() {
    const message = value.trim();
    if ((!message && !files.length) || pending) return;
    const selectedFiles = files;
    setValue('');
    setFiles([]);
    setAttachmentError('');
    if (textareaRef.current) textareaRef.current.style.height = '';
    void onSend(message, selectedFiles);
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

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      className={cn(
        'relative',
        dragActive &&
          'after:pointer-events-none after:absolute after:inset-1 after:rounded-lg after:border-2 after:border-dashed after:border-sky-500 after:bg-sky-50/80 after:content-["Drop_files_here"] after:grid after:place-items-center after:text-xs after:font-semibold after:text-sky-700 after:backdrop-blur-sm dark:after:bg-sky-950/80 dark:after:text-sky-200'
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={onDrop}
    >
      {files.length ? (
        <div className={cn('flex flex-wrap gap-1.5 px-4 pt-3', compact && 'px-2.5 pt-2.5')}>
          {files.map((file, index) => {
            const Icon = file.type.startsWith('image/') ? FileImage : FileText;
            return (
              <div
                key={`${file.name}-${file.lastModified}`}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                <span className="max-w-48 truncate font-medium">{file.name}</span>
                <span className="shrink-0 font-mono text-[9px] text-slate-400">
                  {fileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {attachmentError ? (
        <p role="alert" className="px-4 pt-2 text-xs text-rose-600 dark:text-rose-300">
          {attachmentError}
        </p>
      ) : null}

      <div className={cn('flex items-end gap-2', compact ? 'p-2.5' : 'p-4')}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          onChange={onFileChange}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={pending}
          aria-label="Attach images or files"
          title="Attach images or files"
          className={cn(
            'grid shrink-0 place-items-center rounded-lg border border-slate-200 text-sky-700 shadow-sm hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:text-sky-300 dark:hover:border-sky-800 dark:hover:bg-sky-950/40 dark:hover:text-sky-200',
            compact ? 'h-9 w-9' : 'h-10 w-10'
          )}
        >
          <Paperclip className="h-4 w-4" />
        </button>
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
          placeholder={placeholder}
          aria-label="Message the assistant"
          className={cn(
            'min-h-9 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500',
            compact ? 'max-h-28 text-[13px]' : 'max-h-40 text-sm'
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={(!value.trim() && !files.length) || pending}
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
    </div>
  );
}
