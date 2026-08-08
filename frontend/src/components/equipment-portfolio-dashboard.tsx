'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, Wrench, X } from 'lucide-react';

import {
  EmptyState,
  MetricRail,
  MetricTile,
  PageHeader,
  StatusPill,
} from '@/components/dashboard/primitives';
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
  deleteResource,
  fetchResource,
  selectClassName,
  textareaClassName,
  updateResource,
} from '@/lib/operations/client';
import { cn } from '@/lib/utils';

type Provider = { id: string; name: string };

type EquipmentAsset = {
  id: string;
  asset_code: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  status: 'active' | 'service_due' | 'out_of_service' | 'retired';
  provider_id: string | null;
  notes: string | null;
  provider: Provider | null;
};

type EquipmentForm = {
  assetCode: string;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  location: string;
  status: EquipmentAsset['status'];
  providerId: string;
  notes: string;
};

const statusLabels: Record<EquipmentAsset['status'], string> = {
  active: 'Active',
  service_due: 'Service due',
  out_of_service: 'Out of service',
  retired: 'Retired',
};

function blankForm(): EquipmentForm {
  return {
    assetCode: '',
    name: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    location: '',
    status: 'active',
    providerId: '',
    notes: '',
  };
}

function assetToForm(asset: EquipmentAsset): EquipmentForm {
  return {
    assetCode: asset.asset_code,
    name: asset.name,
    manufacturer: asset.manufacturer ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serial_number ?? '',
    location: asset.location ?? '',
    status: asset.status,
    providerId: asset.provider_id ?? '',
    notes: asset.notes ?? '',
  };
}

function formToPayload(form: EquipmentForm) {
  return {
    asset_code: form.assetCode.trim(),
    name: form.name.trim(),
    manufacturer: form.manufacturer.trim() || null,
    model: form.model.trim() || null,
    serial_number: form.serialNumber.trim() || null,
    location: form.location.trim() || null,
    status: form.status,
    provider_id: form.providerId || null,
    notes: form.notes.trim() || null,
  };
}

function statusTone(status: EquipmentAsset['status']) {
  if (status === 'active') return 'success' as const;
  if (status === 'service_due') return 'warning' as const;
  if (status === 'out_of_service') return 'danger' as const;
  return 'neutral' as const;
}

export function EquipmentPortfolioDashboard() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<EquipmentAsset | null>(null);
  const [form, setForm] = useState<EquipmentForm | null>(null);
  const [message, setMessage] = useState('');

  const assetsQuery = useQuery({
    queryKey: ['operations', 'assets'],
    queryFn: () => fetchResource<EquipmentAsset>('assets'),
    retry: false,
  });
  const providersQuery = useQuery({
    queryKey: ['operations', 'providers'],
    queryFn: () => fetchResource<Provider>('providers'),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async ({
      id,
      draft,
    }: {
      id: string | null;
      draft: EquipmentForm;
    }) =>
      id
        ? updateResource<EquipmentAsset>('assets', id, formToPayload(draft))
        : createResource<EquipmentAsset>('assets', formToPayload(draft)),
    onSuccess: async (_, variables) => {
      setMessage(
        variables.id
          ? 'Equipment details saved.'
          : 'Equipment added to the portfolio.'
      );
      setSelected(null);
      setForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'assets'] }),
        queryClient.invalidateQueries({ queryKey: ['materials'] }),
        queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['operations-header-summary'] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteResource('assets', id),
    onSuccess: async () => {
      setMessage('Equipment removed from the portfolio.');
      setSelected(null);
      setForm(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'assets'] }),
        queryClient.invalidateQueries({ queryKey: ['materials'] }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const assets = assetsQuery.data ?? [];
  const activeCount = assets.filter((asset) => asset.status === 'active').length;
  const serviceDueCount = assets.filter(
    (asset) => asset.status === 'service_due'
  ).length;

  function openNew() {
    setSelected(null);
    setForm(blankForm());
  }

  function openAsset(asset: EquipmentAsset) {
    setSelected(asset);
    setForm(assetToForm(asset));
  }

  function closeModal() {
    setSelected(null);
    setForm(null);
  }

  function removeSelected() {
    if (!selected) return;
    if (
      !window.confirm(
        `Delete "${selected.name}" from the equipment portfolio? Existing lab-book entries will keep their history without this equipment link.`
      )
    ) {
      return;
    }
    deleteMutation.mutate(selected.id);
  }

  if (assetsQuery.isError) {
    return (
      <EmptyState
        error
        title="Equipment portfolio could not be loaded"
        description={(assetsQuery.error as Error).message}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Laboratory settings"
        title="Equipment portfolio"
        description="Define the instruments and supporting equipment used by the lab. Active portfolio names become material destinations in Inventory."
        actions={
          <Button onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add equipment
          </Button>
        }
      />

      {message ? (
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      <MetricRail className="md:grid-cols-3">
        <MetricTile
          label="Portfolio"
          value={assets.length}
          detail="Defined equipment"
          tone="primary"
        />
        <MetricTile
          label="Active"
          value={activeCount}
          detail="Available as destinations"
          tone="success"
        />
        <MetricTile
          label="Service due"
          value={serviceDueCount}
          detail="Needs attention"
          tone={serviceDueCount ? 'warning' : 'success'}
        />
      </MetricRail>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Laboratory equipment</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Select a row to edit identity, location, provider, or operating state.
            </p>
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-md border bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <Wrench className="h-4 w-4" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {assetsQuery.isLoading ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Loading equipment…
            </p>
          ) : assets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Identity</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead aria-label="Edit" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow
                    key={asset.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => openAsset(asset)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openAsset(asset);
                    }}
                  >
                    <TableCell>
                      <p className="font-medium">{asset.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {asset.asset_code}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{[asset.manufacturer, asset.model].filter(Boolean).join(' · ') || '—'}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {asset.serial_number ? `SN ${asset.serial_number}` : 'No serial number'}
                      </p>
                    </TableCell>
                    <TableCell>{asset.location ?? '—'}</TableCell>
                    <TableCell>{asset.provider?.name ?? '—'}</TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(asset.status)}>
                        {statusLabels[asset.status]}
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={`Edit ${asset.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openAsset(asset);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No equipment defined"
              description="Add the first instrument or supporting device. It will immediately become an Inventory destination."
              action={
                <Button size="sm" onClick={openNew}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add equipment
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>

      {form ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="equipment-title"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeModal();
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl border bg-background shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-background px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-primary">
                  Equipment portfolio
                </p>
                <h2 id="equipment-title" className="font-display text-lg font-semibold">
                  {selected ? selected.name : 'Add equipment'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  This name will appear in the material destination dropdown.
                </p>
              </div>
              <Button size="icon" variant="ghost" onClick={closeModal}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <EquipmentField label="Equipment name">
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="GasBench II"
                />
              </EquipmentField>
              <EquipmentField label="Asset code">
                <Input
                  value={form.assetCode}
                  onChange={(event) =>
                    setForm({ ...form, assetCode: event.target.value })
                  }
                  placeholder="P2L-GB-01"
                  className="font-mono"
                />
              </EquipmentField>
              <EquipmentField label="Manufacturer">
                <Input
                  value={form.manufacturer}
                  onChange={(event) =>
                    setForm({ ...form, manufacturer: event.target.value })
                  }
                />
              </EquipmentField>
              <EquipmentField label="Model">
                <Input
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                />
              </EquipmentField>
              <EquipmentField label="Serial number">
                <Input
                  value={form.serialNumber}
                  onChange={(event) =>
                    setForm({ ...form, serialNumber: event.target.value })
                  }
                />
              </EquipmentField>
              <EquipmentField label="Location">
                <Input
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                  placeholder="IRMS room · bench 2"
                />
              </EquipmentField>
              <EquipmentField label="Operating state">
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      status: event.target.value as EquipmentAsset['status'],
                    })
                  }
                  className={selectClassName}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </EquipmentField>
              <EquipmentField label="Responsible provider">
                <select
                  value={form.providerId}
                  onChange={(event) =>
                    setForm({ ...form, providerId: event.target.value })
                  }
                  className={selectClassName}
                >
                  <option value="">Not assigned</option>
                  {(providersQuery.data ?? []).map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </EquipmentField>
              <EquipmentField label="Notes" className="sm:col-span-2">
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className={cn(textareaClassName, 'min-h-20')}
                />
              </EquipmentField>
            </div>

            <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background px-5 py-3">
              {selected ? (
                <Button
                  variant="outline"
                  className="mr-auto border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950"
                  disabled={deleteMutation.isPending}
                  onClick={removeSelected}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete equipment
                </Button>
              ) : (
                <span className="mr-auto" />
              )}
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                disabled={
                  saveMutation.isPending ||
                  !form.name.trim() ||
                  !form.assetCode.trim()
                }
                onClick={() =>
                  saveMutation.mutate({ id: selected?.id ?? null, draft: form })
                }
              >
                <Save className="mr-1.5 h-4 w-4" />
                {selected ? 'Save equipment' : 'Add equipment'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EquipmentField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('space-y-1.5', className)}>
      <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
