'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';

import { EmptyState, StatusPill } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createResource,
  fetchResource,
  textareaClassName,
  updateResource,
} from '@/lib/operations/client';

type Provider = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  categories: string[];
  lead_time_days: number | null;
  status: 'active' | 'paused' | 'archived';
  notes: string | null;
};

const initialDraft = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  categories: '',
  leadTimeDays: '',
  notes: '',
};

export function ProvidersDirectory() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(initialDraft);
  const [message, setMessage] = useState('');
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  const providersQuery = useQuery({
    queryKey: ['operations', 'providers'],
    queryFn: () => fetchResource<Provider>('providers'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      createResource<Provider>('providers', payload),
    onSuccess: async () => {
      setDraft(initialDraft);
      setMessage('Provider saved.');
      setAddProviderOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'providers'] }),
        queryClient.invalidateQueries({ queryKey: ['materials'] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      provider,
      status,
    }: {
      provider: Provider;
      status: Provider['status'];
    }) =>
      updateResource<Provider>('providers', provider.id, {
        name: provider.name,
        status,
      }),
    onSuccess: async () => {
      setMessage('Provider status updated.');
      await queryClient.invalidateQueries({
        queryKey: ['operations', 'providers'],
      });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const providers = useMemo(
    () => providersQuery.data ?? [],
    [providersQuery.data]
  );
  const filteredProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((provider) =>
      [
        provider.name,
        provider.contact_name,
        provider.email,
        provider.categories.join(' '),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [providers, search]);

  function submitProvider(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    createMutation.mutate({
      name: draft.name.trim(),
      contact_name: draft.contactName.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      categories: draft.categories
        .split(',')
        .map((category) => category.trim())
        .filter(Boolean),
      lead_time_days: draft.leadTimeDays ? Number(draft.leadTimeDays) : null,
      status: 'active',
      notes: draft.notes.trim() || null,
    });
  }

  function closeAddProvider() {
    if (createMutation.isPending) return;
    setAddProviderOpen(false);
    setDraft(initialDraft);
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Provider directory</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Maintain purchasing contacts, supply categories, and expected lead times.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddProviderOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add provider
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col gap-2 border-b bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search provider, contact, email, or category"
              className="bg-background pl-9"
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {filteredProviders.length} of {providers.length} providers
          </span>
        </div>

        {message ? (
          <p className="border-b px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
            {message}
          </p>
        ) : null}

        {providersQuery.isError ? (
          <EmptyState
            error
            title="Providers could not be loaded"
            description={(providersQuery.error as Error).message}
          />
        ) : filteredProviders.length ? (
            <Table
              className="min-w-[900px] table-fixed"
              containerClassName="max-h-[520px]"
            >
              <colgroup>
                <col className="w-[31%]" />
                <col className="w-[21%]" />
                <col className="w-[20%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Lead time</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProviders.map((provider) => (
                  <TableRow key={provider.id} className="h-[54px]">
                    <TableCell className="overflow-hidden py-1.5">
                      <p className="truncate font-medium" title={provider.name}>
                        {provider.name}
                      </p>
                      <p
                        className="truncate text-[11px] text-muted-foreground"
                        title={provider.notes ?? 'No purchasing notes'}
                      >
                        {provider.notes ?? 'No purchasing notes'}
                      </p>
                    </TableCell>
                    <TableCell className="overflow-hidden py-1.5">
                      <p className="truncate" title={provider.contact_name ?? undefined}>
                        {provider.contact_name ?? '—'}
                      </p>
                      <p
                        className="truncate text-[11px] text-muted-foreground"
                        title={provider.email ?? provider.phone ?? 'No contact details'}
                      >
                        {provider.email ?? provider.phone ?? 'No contact details'}
                      </p>
                    </TableCell>
                    <TableCell
                      className="overflow-hidden py-1.5"
                      title={provider.categories.join(', ') || undefined}
                    >
                      <p className="truncate">
                      {provider.categories.length ? provider.categories.join(', ') : '—'}
                      </p>
                    </TableCell>
                    <TableCell className="py-1.5 font-mono tabular-nums">
                      {provider.lead_time_days === null
                        ? '—'
                        : `${provider.lead_time_days} days`}
                    </TableCell>
                    <TableCell className="py-1.5">
                      <StatusPill
                        tone={
                          provider.status === 'active'
                            ? 'success'
                            : provider.status === 'paused'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {provider.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            provider,
                            status: provider.status === 'active' ? 'paused' : 'active',
                          })
                        }
                      >
                        {provider.status === 'active' ? 'Pause' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        ) : (
          <EmptyState
            title="No providers match"
            description="Change the search or add the first provider record."
          />
        )}
      </CardContent>

      {addProviderOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-provider-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeAddProvider();
          }}
        >
          <form
            className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border bg-background shadow-2xl"
            onSubmit={submitProvider}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background px-5 py-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
                  Inventory · provider directory
                </p>
                <h2 id="add-provider-title" className="font-display text-lg font-semibold">
                  Add provider
                </h2>
                <p className="text-xs text-muted-foreground">
                  Create a reusable purchasing contact for catalog items and requests.
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                aria-label="Close add provider form"
                onClick={closeAddProvider}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-workspace p-3 sm:grid-cols-2">
              <label className="block text-xs font-medium sm:col-span-2">
                Provider name
                <Input
                  autoFocus
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, name: event.target.value }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium">
                Contact name
                <Input
                  value={draft.contactName}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, contactName: event.target.value }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium">
                Email
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, email: event.target.value }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium">
                Phone
                <Input
                  value={draft.phone}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, phone: event.target.value }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium">
                Lead time in days
                <Input
                  type="number"
                  min="0"
                  value={draft.leadTimeDays}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, leadTimeDays: event.target.value }))
                  }
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium sm:col-span-2">
                Categories
                <Input
                  value={draft.categories}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, categories: event.target.value }))
                  }
                  placeholder="Consumables, spare parts"
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium sm:col-span-2">
                Notes
                <textarea
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, notes: event.target.value }))
                  }
                  className={`${textareaClassName} mt-1`}
                />
              </label>
              {message && createMutation.isError ? (
                <p className="text-xs text-destructive sm:col-span-2" aria-live="polite">
                  {message}
                </p>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background px-5 py-3">
              <Button type="button" variant="outline" onClick={closeAddProvider}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !draft.name.trim()}>
                {createMutation.isPending ? 'Saving…' : 'Save provider'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
