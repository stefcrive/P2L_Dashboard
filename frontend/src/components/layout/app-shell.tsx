'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ListOrdered,
  BookOpenCheck,
  Boxes,
  Building2,
  Bot,
  FlaskConical,
  LayoutDashboard,
  LibraryBig,
  Settings,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';
import { EvoStudioBrand, P2LLogo } from './brand-logos';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/results', label: 'Results', icon: FlaskConical },
  { href: '/queue', label: 'Queue', icon: ListOrdered },
  { href: '/materials', label: 'Inventory', icon: Boxes },
  { href: '/providers', label: 'Providers', icon: Building2 },
  { href: '/lab-book', label: 'Lab book', icon: BookOpenCheck },
  { href: '/knowledge', label: 'Knowledge', icon: LibraryBig },
  { href: '/assistant', label: 'Assistant', icon: Bot },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

type HeaderSummary = {
  source: 'local' | 'supabase' | 'neon' | 'unavailable';
  pendingResults: number;
  maintenanceDue: number;
  lastBackupAt: string | null;
};

type DatabaseReadiness = {
  ready: true;
  source: 'local' | 'supabase' | 'neon';
};

async function fetchDatabaseReadiness(): Promise<DatabaseReadiness> {
  const response = await fetch('/api/database/ready', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Database unavailable');
  }
  return response.json();
}

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

export function AppShell({ children, requireAuth = false }: { children: React.ReactNode; requireAuth?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const headerRef = useRef<HTMLElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const readinessQuery = useQuery({
    enabled: pathname !== '/login',
    queryKey: ['database-readiness'],
    queryFn: fetchDatabaseReadiness,
    refetchInterval: 60_000,
    retry: 4,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
  });
  const summaryQuery = useQuery({
    enabled: pathname !== '/login',
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
  }, [pathname]);

  const summary = summaryQuery.data;
  const databaseReady = readinessQuery.data?.ready === true;
  const databaseStarting = readinessQuery.isPending || readinessQuery.isFetching;

  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="min-h-screen overflow-x-clip">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-white">Skip to workspace</a>
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-50 border-b bg-card">
        <div className="flex min-h-[68px] w-full items-center gap-3 px-4">
          <Link href="/" aria-label="P2L laboratory workspace home" className="flex shrink-0 items-center gap-2.5 rounded-md lg:w-[184px]">
            <P2LLogo />
            <span className="hidden leading-none sm:block"><span className="block text-sm font-semibold">P2L</span><span className="mt-1 block text-xs text-muted-foreground">Laboratory workspace</span></span>
          </Link>
          <div className="hidden items-center gap-2 border-l pl-4 text-sm lg:flex"><span className="text-muted-foreground">Workspace</span><span className="text-border">/</span><strong className="font-medium">{currentItem.label}</strong></div>
          <label className="min-w-0 flex-1 lg:hidden">
            <span className="sr-only">Current section</span>
            <select value={currentItem.href} onChange={(event) => router.push(event.target.value as Route)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm sm:max-w-56">
              {navigation.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-3">
            <EvoStudioBrand compact />
            <span className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground xl:block">{now ? new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeStyle: 'short'}).format(now) : '—'}</span>
            <span className={cn('hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs sm:flex', databaseReady ? 'border-success/20 bg-success/5 text-success' : 'border-warning/20 bg-warning/5 text-warning')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', databaseReady ? 'bg-success' : 'bg-warning')} aria-hidden="true" />
              {databaseReady ? 'Connected' : databaseStarting ? 'Connecting' : 'Connection unavailable'}
            </span>
            <ThemeToggle />
            {requireAuth && <button type="button" className="h-8 rounded-md border bg-card px-2 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={async () => { const response = await fetch('/api/auth/logout', { method: 'POST' }); if (response.ok) window.location.assign('/login'); }}>Sign out</button>}
          </div>
        </div>
      </header>
      <aside className="fixed bottom-0 left-0 top-[var(--app-header-height)] hidden w-[216px] flex-col border-r bg-card p-3 lg:flex">
        <p className="px-2 pb-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Laboratory operations</p>
        <nav className="grid gap-1" aria-label="Primary">
          {navigation.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href as Route} aria-current={active ? 'page' : undefined} className={cn('flex min-h-9 items-center gap-2.5 rounded-md border border-transparent px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground', active && 'border-primary/20 bg-accent text-primary hover:text-primary')}><Icon className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />{item.label}</Link>;
          })}
        </nav>
        <div className="mt-auto space-y-3 border-t px-2 pt-4 text-xs">
          <div className="flex items-center justify-between text-muted-foreground"><span>Results queue</span><strong className="font-mono font-medium text-foreground">{summary?.pendingResults ?? '—'}</strong></div>
          <div className="flex items-center justify-between text-muted-foreground"><span>Maintenance due</span><strong className={cn('font-mono font-medium', summary?.maintenanceDue ? 'text-warning' : 'text-foreground')}>{summary?.maintenanceDue ?? '—'}</strong></div>
          <div className="flex items-center justify-between text-muted-foreground"><span>Last backup</span><strong className="font-mono font-medium text-foreground">{formatBackupAge(summary?.lastBackupAt)}</strong></div>
          <p className="border-t pt-3 text-muted-foreground">P2L · IRMS laboratory</p>
        </div>
      </aside>
      <main id="main-content" className="workspace-main min-w-0 px-3 pb-10 pt-[calc(var(--app-header-height)+16px)] sm:px-4 lg:ml-[216px]">{children}</main>
    </div>
  );
}
