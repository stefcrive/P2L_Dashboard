import * as React from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b pb-2',
        className
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {eyebrow ? (
          <p className="mb-1 font-mono text-xs font-medium uppercase tracking-[0.06em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function SectionPanel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn('workspace-panel overflow-hidden rounded-lg border bg-card', className)}
    >
      <div className="workspace-panel-header border-b">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold leading-tight">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      <div className={cn('p-panel', bodyClassName)}>{children}</div>
    </section>
  );
}

export function MetricRail({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Key metrics"
      className={cn(
        'grid grid-cols-2 overflow-hidden rounded-lg border bg-card divide-x',
        className
      )}
    >
      {children}
    </section>
  );
}

const metricToneClass = {
  neutral: 'before:bg-slate-300 dark:before:bg-slate-700',
  primary: 'before:bg-primary',
  success: 'before:bg-success',
  warning: 'before:bg-warning',
  danger: 'before:bg-destructive',
  special: 'before:bg-special',
};

export function MetricTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: keyof typeof metricToneClass;
}) {
  return (
    <div
      className={cn(
        'relative min-w-0 px-panel py-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5',
        metricToneClass[tone]
      )}
    >
      <p className="font-mono text-xs font-medium uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words font-mono text-lg font-semibold leading-none tabular-nums">
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 truncate text-xs text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-muted p-3',
        className
      )}
    >
      {children}
    </div>
  );
}

const statusToneClass = {
  neutral:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  primary:
    'border-primary/20 bg-accent text-primary',
  success:
    'border-success/20 bg-[var(--success-background)] text-success dark:bg-success/10',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
  danger:
    'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200',
  special:
    'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200',
};

export function StatusPill({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof statusToneClass;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium leading-4',
        statusToneClass[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  error = false,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  error?: boolean;
}) {
  const Icon = error ? AlertCircle : Inbox;
  return (
    <div role={error ? 'alert' : 'status'} className="flex min-h-24 flex-col items-center justify-center rounded-md border border-dashed px-3 py-3 text-center">
      <Icon
        className={cn(
          'mb-1.5 h-4 w-4',
          error ? 'text-destructive' : 'text-muted-foreground'
        )}
        aria-hidden="true"
      />
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
