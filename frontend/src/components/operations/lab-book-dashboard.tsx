'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
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
import { cn } from '@/lib/utils';

type Provider = { id: string; name: string };

type Asset = {
  id: string;
  asset_code: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  status: 'active' | 'service_due' | 'out_of_service' | 'retired';
  provider_id: string | null;
  last_service_at: string | null;
  next_service_at: string | null;
  notes: string | null;
  provider: Provider | null;
};

type LabEntry = {
  id: string;
  entry_type:
    | 'general'
    | 'maintenance'
    | 'calibration'
    | 'incident'
    | 'quality_control';
  title: string;
  occurred_at: string;
  asset_id: string | null;
  provider_id: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  performed_by: string | null;
  description: string | null;
  next_due_at: string | null;
  asset: Pick<Asset, 'id' | 'asset_code' | 'name'> | null;
  provider: Provider | null;
};

type BackupRecord = {
  id: string;
  system_name: string;
  backup_type:
    | 'database'
    | 'documents'
    | 'instrument'
    | 'configuration'
    | 'full';
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'completed' | 'failed' | 'verified';
  destination: string | null;
  size_bytes: number | null;
  verified: boolean;
  notes: string | null;
};

const nowLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (['active', 'completed', 'verified'].includes(status))
    return 'success' as const;
  if (['failed', 'out_of_service'].includes(status)) return 'danger' as const;
  if (['scheduled', 'service_due'].includes(status)) return 'warning' as const;
  if (['in_progress', 'running'].includes(status)) return 'primary' as const;
  return 'neutral' as const;
}

export function LabBookDashboard() {
  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'entry' | 'asset' | 'backup'>(
    'entry'
  );
  const [message, setMessage] = useState('');
  const [entryDraft, setEntryDraft] = useState({
    entryType: 'maintenance' as LabEntry['entry_type'],
    title: '',
    occurredAt: nowLocal(),
    assetId: '',
    providerId: '',
    status: 'completed' as LabEntry['status'],
    performedBy: '',
    description: '',
    nextDueAt: '',
  });
  const [assetDraft, setAssetDraft] = useState({
    code: '',
    name: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    location: '',
    providerId: '',
    nextServiceAt: '',
    notes: '',
  });
  const [backupDraft, setBackupDraft] = useState({
    systemName: 'P2L local database',
    backupType: 'database' as BackupRecord['backup_type'],
    startedAt: nowLocal(),
    completedAt: nowLocal(),
    status: 'verified' as BackupRecord['status'],
    destination: '',
    verified: true,
    notes: '',
  });

  const providersQuery = useQuery({
    queryKey: ['operations', 'providers'],
    queryFn: () => fetchResource<Provider>('providers'),
    retry: false,
  });
  const assetsQuery = useQuery({
    queryKey: ['operations', 'assets'],
    queryFn: () => fetchResource<Asset>('assets'),
    retry: false,
  });
  const entriesQuery = useQuery({
    queryKey: ['operations', 'lab-book'],
    queryFn: () => fetchResource<LabEntry>('lab-book'),
    retry: false,
  });
  const backupsQuery = useQuery({
    queryKey: ['operations', 'backups'],
    queryFn: () => fetchResource<BackupRecord>('backups'),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: ({
      resource,
      payload,
    }: {
      resource: 'lab-book' | 'assets' | 'backups';
      payload: Record<string, unknown>;
    }) => createResource(resource, payload),
    onSuccess: async (_, variables) => {
      setMessage('Record saved.');
      if (variables.resource === 'lab-book') {
        setEntryDraft((value) => ({ ...value, title: '', description: '' }));
      } else if (variables.resource === 'assets') {
        setAssetDraft((value) => ({
          ...value,
          code: '',
          name: '',
          serialNumber: '',
        }));
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['operations', variables.resource],
        }),
        queryClient.invalidateQueries({ queryKey: ['operations-summary'] }),
        queryClient.invalidateQueries({
          queryKey: ['operations-header-summary'],
        }),
      ]);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      resource,
      id,
      payload,
    }: {
      resource: 'lab-book' | 'assets' | 'backups';
      id: string;
      payload: Record<string, unknown>;
    }) => updateResource(resource, id, payload),
    onSuccess: async (_, variables) => {
      setMessage('Record updated.');
      await queryClient.invalidateQueries({
        queryKey: ['operations', variables.resource],
      });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const providers = providersQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  const backups = backupsQuery.data ?? [];
  const databaseError =
    (entriesQuery.error as Error | null)?.message ??
    (assetsQuery.error as Error | null)?.message ??
    (backupsQuery.error as Error | null)?.message;

  const dueEntries = entries.filter(
    (entry) =>
      entry.next_due_at &&
      new Date(entry.next_due_at).getTime() <= Date.now() &&
      entry.status !== 'cancelled'
  ).length;
  const serviceDueAssets = assets.filter(
    (asset) => asset.status === 'service_due'
  ).length;
  const failedBackups = backups.filter(
    (backup) => backup.status === 'failed'
  ).length;
  const verifiedBackups = backups.filter((backup) => backup.verified).length;

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate({
      resource: 'lab-book',
      payload: {
        entry_type: entryDraft.entryType,
        title: entryDraft.title.trim(),
        occurred_at: new Date(entryDraft.occurredAt).toISOString(),
        asset_id: entryDraft.assetId || null,
        provider_id: entryDraft.providerId || null,
        status: entryDraft.status,
        performed_by: entryDraft.performedBy.trim() || null,
        description: entryDraft.description.trim() || null,
        next_due_at: entryDraft.nextDueAt
          ? new Date(entryDraft.nextDueAt).toISOString()
          : null,
      },
    });
  }

  function submitAsset(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate({
      resource: 'assets',
      payload: {
        asset_code: assetDraft.code.trim(),
        name: assetDraft.name.trim(),
        manufacturer: assetDraft.manufacturer.trim() || null,
        model: assetDraft.model.trim() || null,
        serial_number: assetDraft.serialNumber.trim() || null,
        location: assetDraft.location.trim() || null,
        status: 'active',
        provider_id: assetDraft.providerId || null,
        next_service_at: assetDraft.nextServiceAt
          ? new Date(assetDraft.nextServiceAt).toISOString()
          : null,
        notes: assetDraft.notes.trim() || null,
      },
    });
  }

  function submitBackup(event: FormEvent) {
    event.preventDefault();
    createMutation.mutate({
      resource: 'backups',
      payload: {
        system_name: backupDraft.systemName.trim(),
        backup_type: backupDraft.backupType,
        started_at: new Date(backupDraft.startedAt).toISOString(),
        completed_at: backupDraft.completedAt
          ? new Date(backupDraft.completedAt).toISOString()
          : null,
        status: backupDraft.status,
        destination: backupDraft.destination.trim() || null,
        verified: backupDraft.verified,
        notes: backupDraft.notes.trim() || null,
      },
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Laboratory record"
        title="Lab book"
        description="Keep maintenance, calibration, incidents, equipment, and backup verification in one chronological operating record."
      />

      {databaseError ? (
        <EmptyState
          error
          title="The laboratory book could not be loaded"
          description={databaseError}
        />
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
            <SectionPanel
              title="Record laboratory work"
              description="Choose the type of operational record to add."
              actions={
                <div className="flex rounded-md bg-muted p-0.5">
                  {(['entry', 'asset', 'backup'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFormMode(mode)}
                      className={cn(
                        'h-7 rounded px-2 text-[11px] font-medium capitalize',
                        formMode === mode
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {mode === 'entry' ? 'Lab entry' : mode}
                    </button>
                  ))}
                </div>
              }
            >
              {formMode === 'entry' ? (
                <form className="space-y-3" onSubmit={submitEntry}>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Entry type
                      <select
                        value={entryDraft.entryType}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            entryType: event.target
                              .value as LabEntry['entry_type'],
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="maintenance">Maintenance</option>
                        <option value="calibration">Calibration</option>
                        <option value="quality_control">Quality control</option>
                        <option value="incident">Incident</option>
                        <option value="general">General</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium">
                      Status
                      <select
                        value={entryDraft.status}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            status: event.target.value as LabEntry['status'],
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    Title
                    <Input
                      required
                      value={entryDraft.title}
                      onChange={(event) =>
                        setEntryDraft((value) => ({
                          ...value,
                          title: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Occurred at
                    <Input
                      required
                      type="datetime-local"
                      value={entryDraft.occurredAt}
                      onChange={(event) =>
                        setEntryDraft((value) => ({
                          ...value,
                          occurredAt: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Equipment
                      <select
                        value={entryDraft.assetId}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            assetId: event.target.value,
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="">No equipment</option>
                        {assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.asset_code} · {asset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-medium">
                      Provider
                      <select
                        value={entryDraft.providerId}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            providerId: event.target.value,
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="">No provider</option>
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Performed by
                      <Input
                        value={entryDraft.performedBy}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            performedBy: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Next due
                      <Input
                        type="datetime-local"
                        value={entryDraft.nextDueAt}
                        onChange={(event) =>
                          setEntryDraft((value) => ({
                            ...value,
                            nextDueAt: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    Description
                    <textarea
                      value={entryDraft.description}
                      onChange={(event) =>
                        setEntryDraft((value) => ({
                          ...value,
                          description: event.target.value,
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
                    Save lab entry
                  </Button>
                </form>
              ) : null}

              {formMode === 'asset' ? (
                <form className="space-y-3" onSubmit={submitAsset}>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Asset code
                      <Input
                        required
                        value={assetDraft.code}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            code: event.target.value,
                          }))
                        }
                        placeholder="IRMS-01"
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Equipment name
                      <Input
                        required
                        value={assetDraft.name}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            name: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Manufacturer
                      <Input
                        value={assetDraft.manufacturer}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            manufacturer: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Model
                      <Input
                        value={assetDraft.model}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            model: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Serial number
                      <Input
                        value={assetDraft.serialNumber}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            serialNumber: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Location
                      <Input
                        value={assetDraft.location}
                        onChange={(event) =>
                          setAssetDraft((value) => ({
                            ...value,
                            location: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    Service provider
                    <select
                      value={assetDraft.providerId}
                      onChange={(event) =>
                        setAssetDraft((value) => ({
                          ...value,
                          providerId: event.target.value,
                        }))
                      }
                      className={`${selectClassName} mt-1`}
                    >
                      <option value="">No provider</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium">
                    Next service
                    <Input
                      type="datetime-local"
                      value={assetDraft.nextServiceAt}
                      onChange={(event) =>
                        setAssetDraft((value) => ({
                          ...value,
                          nextServiceAt: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Notes
                    <textarea
                      value={assetDraft.notes}
                      onChange={(event) =>
                        setAssetDraft((value) => ({
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
                    Save equipment
                  </Button>
                </form>
              ) : null}

              {formMode === 'backup' ? (
                <form className="space-y-3" onSubmit={submitBackup}>
                  <label className="block text-xs font-medium">
                    System
                    <Input
                      required
                      value={backupDraft.systemName}
                      onChange={(event) =>
                        setBackupDraft((value) => ({
                          ...value,
                          systemName: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Backup type
                      <select
                        value={backupDraft.backupType}
                        onChange={(event) =>
                          setBackupDraft((value) => ({
                            ...value,
                            backupType: event.target
                              .value as BackupRecord['backup_type'],
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="database">Database</option>
                        <option value="documents">Documents</option>
                        <option value="instrument">Instrument</option>
                        <option value="configuration">Configuration</option>
                        <option value="full">Full</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium">
                      Status
                      <select
                        value={backupDraft.status}
                        onChange={(event) =>
                          setBackupDraft((value) => ({
                            ...value,
                            status: event.target
                              .value as BackupRecord['status'],
                            verified: event.target.value === 'verified',
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="running">Running</option>
                        <option value="completed">Completed</option>
                        <option value="verified">Verified</option>
                        <option value="failed">Failed</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Started
                      <Input
                        required
                        type="datetime-local"
                        value={backupDraft.startedAt}
                        onChange={(event) =>
                          setBackupDraft((value) => ({
                            ...value,
                            startedAt: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Completed
                      <Input
                        type="datetime-local"
                        value={backupDraft.completedAt}
                        onChange={(event) =>
                          setBackupDraft((value) => ({
                            ...value,
                            completedAt: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium">
                    Destination
                    <Input
                      value={backupDraft.destination}
                      onChange={(event) =>
                        setBackupDraft((value) => ({
                          ...value,
                          destination: event.target.value,
                        }))
                      }
                      placeholder="Encrypted local archive"
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Notes
                    <textarea
                      value={backupDraft.notes}
                      onChange={(event) =>
                        setBackupDraft((value) => ({
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
                    Save backup record
                  </Button>
                </form>
              ) : null}
              <p
                className="mt-3 min-h-4 text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                {message}
              </p>
            </SectionPanel>

            <SectionPanel
              title="Chronological lab book"
              description="Maintenance, calibration, incidents, and quality control."
              bodyClassName="p-0"
            >
              {entries.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry</TableHead>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Performed</TableHead>
                      <TableHead>Next due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-[11px] capitalize text-muted-foreground">
                            {entry.entry_type.replace('_', ' ')}
                          </p>
                        </TableCell>
                        <TableCell>
                          {entry.asset?.asset_code ?? 'General lab'}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatDateTime(entry.occurred_at)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatDateTime(entry.next_due_at)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={statusTone(entry.status)}>
                            {entry.status.replace('_', ' ')}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
                          {entry.status !== 'completed' &&
                          entry.status !== 'cancelled' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updateMutation.isPending}
                              onClick={() =>
                                updateMutation.mutate({
                                  resource: 'lab-book',
                                  id: entry.id,
                                  payload: { status: 'completed' },
                                })
                              }
                            >
                              Complete
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Recorded
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No laboratory entries yet"
                  description="Record maintenance, calibration, quality control, or an incident."
                />
              )}
            </SectionPanel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionPanel
              title="Equipment register"
              description="Assets, service state, and responsible provider."
              bodyClassName="p-0"
            >
              {assets.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Next service</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell>
                          <p className="font-mono font-medium">
                            {asset.asset_code}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {asset.name}
                          </p>
                        </TableCell>
                        <TableCell>{asset.location ?? '—'}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatDateTime(asset.next_service_at)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={statusTone(asset.status)}>
                            {asset.status.replace('_', ' ')}
                          </StatusPill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No equipment assets"
                  description="Add instruments and supporting equipment to track service."
                />
              )}
            </SectionPanel>

            <SectionPanel
              title="Backup register"
              description="Evidence that database, documents, and instrument data are protected."
              bodyClassName="p-0"
            >
              {backups.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>System</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((backup) => (
                      <TableRow key={backup.id}>
                        <TableCell>
                          <p className="font-medium">{backup.system_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {backup.destination ?? 'No destination recorded'}
                          </p>
                        </TableCell>
                        <TableCell className="capitalize">
                          {backup.backup_type}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {formatDateTime(backup.started_at)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={statusTone(backup.status)}>
                            {backup.status}
                          </StatusPill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title="No backup evidence"
                  description="Record the first database, document, or instrument backup."
                />
              )}
            </SectionPanel>
          </div>
        </>
      )}
    </div>
  );
}
