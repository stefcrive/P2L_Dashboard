'use client';

import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { cn } from '@/lib/utils';

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 font-display text-xl font-semibold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 font-display text-lg font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 font-display text-base font-semibold first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="my-2 leading-6 first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 leading-6">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 leading-6">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-sky-600 underline decoration-sky-300 underline-offset-2 hover:text-sky-500 dark:text-sky-400"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-sky-500 bg-sky-50/70 py-1 pl-3 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.startsWith('language-');
    return (
      <code
        className={cn(
          'font-mono',
          isBlock
            ? 'block overflow-x-auto text-[12px] leading-5'
            : 'rounded bg-slate-100 px-1 py-0.5 text-[0.9em] text-slate-800 dark:bg-slate-800 dark:text-slate-100'
        )}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-3 text-slate-100 dark:border-slate-800">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full border-collapse text-left text-[0.92em]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-semibold dark:border-slate-800">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800/70">
      {children}
    </td>
  ),
  hr: () => <hr className="my-4 border-slate-200 dark:border-slate-800" />,
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900 dark:text-slate-100">
      {children}
    </strong>
  ),
};

function normalizeMathDelimiters(content: string) {
  return (
    content
      // Accept standard LaTeX delimiters in older and externally supplied answers.
      .replace(
        /\\\[([\s\S]*?)\\\]/g,
        (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`
      )
      .replace(
        /\\\(([^\n]*?)\\\)/g,
        (_, expression: string) => `$${expression.trim()}$`
      )
      // Repair the model's occasional "[ \\formula ]" pseudo-delimiter without
      // touching Markdown links or [KB:<id>] citations.
      .replace(
        /\[\s*((?=[^\]\n]*\\[A-Za-z]+)(?=[^\]\n]*(?:[_^{}=]|\\frac))[^\]\n]+?)\s*\]/g,
        (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`
      )
  );
}

export function MarkdownResponse({
  content,
  className,
  evidence = [],
}: {
  content: string;
  className?: string;
  evidence?: Array<{ chunkId: number }>;
}) {
  const citationIds = new Set(evidence.map((item) => Number(item.chunkId)));
  const normalizedContent = normalizeMathDelimiters(content)
    // The model occasionally emits task-list syntax for ordinary bullets. In
    // this read-only response it renders as a stray checkbox on every line.
    .replace(/^(\s*[-*+])\s+\[[ xX]\]\s+/gm, '$1 ')
    .replace(/\[KB:(\d+)\](?!\()/g, (citation, value: string) => {
      const chunkId = Number(value);
      return citationIds.has(chunkId)
        ? `[KB:${chunkId}](/knowledge/passages/${chunkId})`
        : citation;
    });
  return (
    <div
      className={cn(
        'markdown-response min-w-0 break-words text-slate-800 dark:text-slate-200',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={markdownComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
