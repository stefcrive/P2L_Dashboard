'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Beaker,
  BookOpenCheck,
  Boxes,
  Building2,
  Bot,
  CircleDollarSign,
  FlaskConical,
  LayoutDashboard,
  LibraryBig,
  Settings,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/results', label: 'Results', icon: FlaskConical },
  { href: '/finance', label: 'Finance', icon: CircleDollarSign },
  { href: '/materials', label: 'Inventory', icon: Boxes },
  { href: '/providers', label: 'Providers', icon: Building2 },
  { href: '/lab-book', label: 'Lab book', icon: BookOpenCheck },
  { href: '/knowledge', label: 'Knowledge', icon: LibraryBig },
  { href: '/assistant', label: 'Assistant', icon: Bot },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

type HeaderSummary = {
  source: 'local' | 'supabase' | 'unavailable';
  pendingResults: number;
  maintenanceDue: number;
  lastBackupAt: string | null;
};

async function fetchHeaderSummary(): Promise<HeaderSummary> {
  const response = await fetch('/api/operations/summary', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Local database unavailable');
  }
  return response.json();
}

function formatBackupAge(value: string | null | undefined) {
  if (!value) return 'No backup';
  const deltaMs = Date.now() - new Date(value).getTime();
  const hours = Math.max(0, Math.round(deltaMs / 3_600_000));
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const summaryQuery = useQuery({
    queryKey: ['operations-header-summary'],
    queryFn: fetchHeaderSummary,
    refetchInterval: 60_000,
    retry: false,
  });

  const currentItem = useMemo(
    () =>
      navigation.find((item) =>
        item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
      ) ?? navigation[0],
    [pathname]
  );

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--app-header-height',
        `${header.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const summary = summaryQuery.data;
  const databaseReady =
    summary?.source === 'local' || summary?.source === 'supabase';

  return (
    <div className="min-h-screen overflow-x-clip">
      <header
        ref={headerRef}
        className="fixed inset-x-0 top-0 z-50 border-b bg-white/95 shadow-sm backdrop-blur dark:bg-slate-950/95"
      >
        <div className="flex min-h-14 w-full items-center gap-3 px-3 md:px-4 lg:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid h-8 w-8 place-items-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <Beaker className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="hidden leading-none sm:block">
              <span className="block font-display text-sm font-semibold">
                P2L
              </span>
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground">
                Laboratory OS
              </span>
            </span>
          </Link>

          <nav
            className="ml-2 hidden flex-1 items-center gap-1 xl:flex"
            aria-label="Primary"
          >
            {navigation.map((item) => {
              const active =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                  <Link
                  key={item.href}
                  href={item.href as Route}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                    active &&
                      'bg-blue-50 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)] dark:bg-blue-950/50'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <label className="relative ml-auto flex-1 xl:hidden">
            <span className="sr-only">Current section</span>
            <select
              value={currentItem.href}
              onChange={(event) => router.push(event.target.value as Route)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-medium sm:max-w-56"
            >
              {navigation.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex items-center gap-1 xl:ml-0">
            <span
              className={cn(
                'hidden items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] lg:flex',
                databaseReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  databaseReady ? 'bg-emerald-500' : 'bg-rose-500'
                )}
                aria-hidden="true"
              />
              {databaseReady ? 'Local DB' : 'DB offline'}
            </span>
            <ThemeToggle />
          </div>
        </div>

        <div className="border-t bg-slate-50/90 dark:bg-slate-900/85">
          <div className="flex min-h-9 w-full items-center gap-3 px-3 font-mono text-[10px] text-muted-foreground md:px-4 lg:px-6">
            <span className="whitespace-nowrap tabular-nums">
              {now
                ? new Intl.DateTimeFormat('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(now)
                : '—'}
            </span>
            <span className="hidden text-border sm:inline">/</span>
            <span className="hidden truncate sm:inline">
              P2L · IRMS laboratory
            </span>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden whitespace-nowrap md:inline">
                Results queue{' '}
                <strong className="font-semibold text-foreground tabular-nums">
                  {summary?.pendingResults ?? '—'}
                </strong>
              </span>
              <span className="hidden whitespace-nowrap md:inline">
                Maintenance due{' '}
                <strong
                  className={cn(
                    'font-semibold tabular-nums',
                    summary?.maintenanceDue ? 'text-warning' : 'text-foreground'
                  )}
                >
                  {summary?.maintenanceDue ?? '—'}
                </strong>
              </span>
              <span className="whitespace-nowrap">
                Last backup{' '}
                <strong className="font-semibold text-foreground">
                  {formatBackupAge(summary?.lastBackupAt)}
                </strong>
              </span>
            </div>
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="w-full px-3 pb-10 pt-[calc(var(--app-header-height)+20px)] md:px-4 lg:px-6"
      >
        {children}
      </main>
    </div>
  );
}
