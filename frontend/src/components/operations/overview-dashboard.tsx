'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Database, RefreshCw } from 'lucide-react';

import {
  EmptyState,
  MetricRail,
  MetricTile,
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Summary = {
  source: 'local' | 'supabase' | 'unavailable';
  error?: string;
  pendingResults: number;
  maintenanceDue: number;
  lastBackupAt: string | null;
  metrics: {
    clients: number;
    documents: number;
    results: number;
    openInvoices: number;
    outstandingAmount: number;
    lowStock: number;
    activeProviders: number;
    assets: number;
  };
  recentActivity: Array<{
    id: string;
    kind: 'lab_book' | 'result' | 'invoice';
    title: string;
    detail: string;
    status: string;
    occurredAt: string;
  }>;
};

async function fetchSummary(): Promise<Summary> {
  const response = await fetch('/api/operations/summary', {
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error('The operations summary could not be loaded.');
  return response.json();
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusTone(
  status: string
): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
  if (
    ['completed', 'verified', 'validated', 'released', 'paid'].includes(status)
  ) {
    return 'success';
  }
  if (['failed', 'overdue', 'void'].includes(status)) return 'danger';
  if (['draft', 'scheduled', 'sent'].includes(status)) return 'warning';
  if (['running', 'in_progress'].includes(status)) return 'primary';
  return 'neutral';
}

export function OverviewDashboard() {
  const summaryQuery = useQuery({
    queryKey: ['operations-summary'],
    queryFn: fetchSummary,
    refetchInterval: 60_000,
    retry: false,
  });
  const summary = summaryQuery.data;
  const metrics = summary?.metrics;

  const workQueue = [
    {
      label: 'Draft results',
      value: summary?.pendingResults ?? 0,
      href: '/results',
      detail: 'Validate measurements before client release.',
      tone: summary?.pendingResults ? 'warning' : 'success',
    },
    {
      label: 'Maintenance due',
      value: summary?.maintenanceDue ?? 0,
      href: '/lab-book',
      detail: 'Review equipment and scheduled service entries.',
      tone: summary?.maintenanceDue ? 'warning' : 'success',
    },
    {
      label: 'Low-stock items',
      value: metrics?.lowStock ?? 0,
      href: '/materials',
      detail: 'Restock consumables at or below minimum.',
      tone: metrics?.lowStock ? 'warning' : 'success',
    },
    {
      label: 'Open invoices',
      value: metrics?.openInvoices ?? 0,
      href: '/clients',
      detail: 'Review invoices within each client record.',
      tone: metrics?.openInvoices ? 'primary' : 'success',
    },
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Laboratory operations"
        title="Operations overview"
        description="See client work, laboratory readiness, purchasing pressure, and record integrity in one place."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => summaryQuery.refetch()}
              disabled={summaryQuery.isFetching}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${
                  summaryQuery.isFetching ? 'animate-spin' : ''
                }`}
              />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/lab-book">Add lab entry</Link>
            </Button>
          </>
        }
      />

      <MetricRail className="md:grid-cols-4">
        <MetricTile
          label="Active clients"
          value={metrics?.clients ?? 0}
          detail={`${metrics?.documents ?? 0} indexed documents`}
          tone="primary"
        />
        <MetricTile
          label="Recorded results"
          value={metrics?.results ?? 0}
          detail={`${summary?.pendingResults ?? 0} awaiting validation`}
          tone={summary?.pendingResults ? 'warning' : 'success'}
        />
        <MetricTile
          label="Outstanding"
          value={`€${(metrics?.outstandingAmount ?? 0).toLocaleString('en-GB', {
            minimumFractionDigits: 2,
          })}`}
          detail={`${metrics?.openInvoices ?? 0} open invoices`}
          tone={metrics?.openInvoices ? 'primary' : 'neutral'}
        />
        <MetricTile
          label="Lab readiness"
          value={summary?.maintenanceDue ? 'Attention' : 'Ready'}
          detail={`${metrics?.assets ?? 0} assets · ${metrics?.lowStock ?? 0} low stock`}
          tone={
            summary?.maintenanceDue || metrics?.lowStock ? 'warning' : 'success'
          }
        />
      </MetricRail>

      {summary?.source === 'unavailable' ? (
        <EmptyState
          error
          title="Local database is offline"
          description={
            summary.error ??
            'Restart the application and check the local database directory.'
          }
          action={
            <span className="inline-flex items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-[11px]">
              <Database className="h-3.5 w-3.5" />
              npm run dev:local
            </span>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.6fr]">
          <SectionPanel
            title="Work queue"
            description="Items that need the laboratory team’s attention."
            bodyClassName="p-0"
          >
            <ul className="divide-y">
              {workQueue.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                  >
                    <span
                      className={`h-8 w-0.5 shrink-0 rounded-full ${
                        item.tone === 'warning'
                          ? 'bg-warning'
                          : item.tone === 'primary'
                            ? 'bg-primary'
                            : 'bg-success'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-semibold">
                          {item.label}
                        </span>
                        <span className="font-mono text-base font-semibold tabular-nums">
                          {item.value}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          </SectionPanel>

          <SectionPanel
            title="Recent activity"
            description="Latest results, invoices, and laboratory book records."
            bodyClassName="p-0"
          >
            {summary?.recentActivity.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recorded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recentActivity.map((activity) => (
                    <TableRow key={activity.id}>
                      <TableCell>
                        <p className="font-medium">{activity.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {activity.detail}
                        </p>
                      </TableCell>
                      <TableCell className="capitalize">
                        {activity.kind.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={statusTone(activity.status)}>
                          {activity.status.replace('_', ' ')}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] tabular-nums">
                        {formatDateTime(activity.occurredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No operational activity yet"
                description="Client results, invoices, and laboratory entries will appear here as the team records them."
              />
            )}
          </SectionPanel>
        </div>
      )}
    </div>
  );
}
