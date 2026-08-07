'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
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
  selectClassName,
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

export function ProvidersDashboard() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(initialDraft);
  const [message, setMessage] = useState('');

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
      await queryClient.invalidateQueries({
        queryKey: ['operations', 'providers'],
      });
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

  const categoryCount = new Set(
    providers.flatMap((provider) => provider.categories)
  ).size;
  const activeProviders = providers.filter(
    (provider) => provider.status === 'active'
  );
  const averageLeadTime = activeProviders.length
    ? Math.round(
        activeProviders.reduce(
          (sum, provider) => sum + Number(provider.lead_time_days ?? 0),
          0
        ) / activeProviders.length
      )
    : 0;

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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Supply chain"
        title="Providers"
        description="Maintain approved contacts, purchasing categories, and expected lead times for laboratory supply."
      />

      <Toolbar>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search provider, contact, email, or category"
            className="pl-9"
          />
        </div>
      </Toolbar>

      {providersQuery.isError ? (
        <EmptyState
          error
          title="Providers could not be loaded"
          description={(providersQuery.error as Error).message}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <SectionPanel
            title="Add provider"
            description="Create one reusable purchasing contact."
          >
            <form className="space-y-3" onSubmit={submitProvider}>
              <label className="block text-xs font-medium">
                Provider name
                <Input
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-xs font-medium">
                  Contact name
                  <Input
                    value={draft.contactName}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        contactName: event.target.value,
                      }))
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
                      setDraft((value) => ({
                        ...value,
                        email: event.target.value,
                      }))
                    }
                    className="mt-1"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-xs font-medium">
                  Phone
                  <Input
                    value={draft.phone}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        phone: event.target.value,
                      }))
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
                      setDraft((value) => ({
                        ...value,
                        leadTimeDays: event.target.value,
                      }))
                    }
                    className="mt-1"
                  />
                </label>
              </div>
              <label className="block text-xs font-medium">
                Categories
                <Input
                  value={draft.categories}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      categories: event.target.value,
                    }))
                  }
                  placeholder="Consumables, spare parts"
                  className="mt-1"
                />
              </label>
              <label className="block text-xs font-medium">
                Notes
                <textarea
                  value={draft.notes}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      notes: event.target.value,
                    }))
                  }
                  className={`${textareaClassName} mt-1`}
                />
              </label>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full"
              >
                Save provider
              </Button>
              <p
                className="min-h-4 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                {message}
              </p>
            </form>
          </SectionPanel>

          <SectionPanel
            title="Provider directory"
            description={`${filteredProviders.length} records match the current search.`}
            bodyClassName="p-0"
          >
            {filteredProviders.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Lead time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProviders.map((provider) => (
                    <TableRow key={provider.id}>
                      <TableCell>
                        <p className="font-medium">{provider.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {provider.notes ?? 'No purchasing notes'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>{provider.contact_name ?? '—'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {provider.email ??
                            provider.phone ??
                            'No contact details'}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        {provider.categories.length
                          ? provider.categories.join(', ')
                          : '—'}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {provider.lead_time_days === null
                          ? '—'
                          : `${provider.lead_time_days} days`}
                      </TableCell>
                      <TableCell>
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
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={statusMutation.isPending}
                          onClick={() =>
                            statusMutation.mutate({
                              provider,
                              status:
                                provider.status === 'active'
                                  ? 'paused'
                                  : 'active',
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
                description="Change the search or save the first provider record."
              />
            )}
          </SectionPanel>
        </div>
      )}
    </div>
  );
}
