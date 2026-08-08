'use client';

import Link from 'next/link';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownAZ,
  BarChart3,
  Clock3,
  ExternalLink,
  FilePlus2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  PageHeader,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Badge } from '@/components/ui/badge';
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
  CREDIT_EVENT_EQUIPMENT_OPTIONS,
  CREDIT_EVENT_TYPES,
  type ClientManagerDataResponse,
  type ClientWithDocuments,
  type CreditEventType,
  type DocumentCategory,
} from '@/lib/client-manager/types';
import { cn } from '@/lib/utils';

interface FiltersState {
  search: string;
  year: string;
  category: 'all' | DocumentCategory;
}

type ClientSort = 'name' | 'updated';

interface CreditEventDraft {
  eventDate: string;
  eventType: CreditEventType;
  analysesCount: string;
  equipment: string;
  unitCost: string;
  amount: string;
  comment: string;
}

interface CreditEventMutationPayload {
  eventType: CreditEventType;
  eventDate: string | null;
  analysesCount: number | null;
  equipment: string | null;
  unitCost: number | null;
  amount: number | null;
  comment: string | null;
}

interface ClientRecordDraft {
  id: string;
  name: string;
  billingDetails: string;
  email: string;
  phone: string;
  taxId: string;
}

const categoryLabel: Record<DocumentCategory, string> = {
  quote: 'Quote',
  invoice: 'Invoice',
  payment_slip: 'Payment Slip',
  payment_receipt: 'Receipt',
  credit: 'Credit',
  purchase_order: 'PO',
  shipping: 'Shipping',
  analysis: 'Analysis',
  other: 'Other',
};

const creditEventTypeLabel: Record<CreditEventType, string> = {
  analysis: 'Analysis',
  credit_topup: 'Credit Top-up',
  adjustment: 'Adjustment',
};

function formatDate(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatBytes(value: number): string {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let working = value;
  let index = 0;
  while (working >= 1024 && index < units.length - 1) {
    working /= 1024;
    index += 1;
  }
  return `${working.toFixed(working >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedCurrency(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`;
}

function parseNullableNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCreditEventType(value: string): CreditEventType {
  return (
    CREDIT_EVENT_TYPES.find((eventType) => eventType === value.trim()) ??
    'adjustment'
  );
}

function createCreditEventDraft(): CreditEventDraft {
  return {
    eventDate: new Date().toISOString().slice(0, 10),
    eventType: 'adjustment',
    analysesCount: '',
    equipment: '',
    unitCost: '',
    amount: '',
    comment: '',
  };
}

function createClientRecordDraft(
  client?: Pick<
    ClientWithDocuments,
    'id' | 'name' | 'billing_details' | 'email' | 'phone' | 'tax_id'
  >
): ClientRecordDraft {
  return {
    id: client?.id ?? '',
    name: client?.name ?? '',
    billingDetails: client?.billing_details ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    taxId: client?.tax_id ?? '',
  };
}

function CreditEventFormFields({
  draft,
  idPrefix,
  onChange,
}: {
  draft: CreditEventDraft;
  idPrefix: string;
  onChange: (field: keyof CreditEventDraft, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Event date
        </span>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          value={draft.eventDate}
          onChange={(event) => onChange('eventDate', event.target.value)}
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Type
        </span>
        <select
          id={`${idPrefix}-type`}
          value={draft.eventType}
          onChange={(event) => onChange('eventType', event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {Object.entries(creditEventTypeLabel).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Number of analyses
        </span>
        <Input
          id={`${idPrefix}-analyses`}
          type="number"
          min="0"
          step="1"
          value={draft.analysesCount}
          onChange={(event) => onChange('analysesCount', event.target.value)}
          placeholder="e.g. 12"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Equipment
        </span>
        <select
          id={`${idPrefix}-equipment`}
          value={draft.equipment}
          onChange={(event) => onChange('equipment', event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Not specified</option>
          {CREDIT_EVENT_EQUIPMENT_OPTIONS.map((equipment) => (
            <option key={equipment} value={equipment}>
              {equipment}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Unit cost
        </span>
        <Input
          id={`${idPrefix}-unit-cost`}
          type="number"
          min="0"
          step="0.01"
          value={draft.unitCost}
          onChange={(event) => onChange('unitCost', event.target.value)}
          placeholder="BRL"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Amount override (sign is automatic)
        </span>
        <Input
          id={`${idPrefix}-amount`}
          type="number"
          step="0.01"
          value={draft.amount}
          onChange={(event) => onChange('amount', event.target.value)}
          placeholder="Auto if blank"
        />
      </label>
      <label className="space-y-1 sm:col-span-2 lg:col-span-6">
        <span className="text-[11px] font-medium text-muted-foreground">
          Comment
        </span>
        <Input
          id={`${idPrefix}-comment`}
          value={draft.comment}
          onChange={(event) => onChange('comment', event.target.value)}
          placeholder="Add context for this ledger event"
        />
      </label>
    </div>
  );
}

async function fetchClientManagerData(
  filters: FiltersState
): Promise<ClientManagerDataResponse> {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.year !== 'all') params.set('year', filters.year);
  if (filters.category !== 'all') params.set('category', filters.category);

  const endpoint = params.toString()
    ? `/api/client-manager/data?${params.toString()}`
    : '/api/client-manager/data';

  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      payload?.error ?? `Request failed with status ${response.status}`
    );
  }
  return response.json();
}

async function createCreditEvent(payload: {
  clientId: string;
} & CreditEventMutationPayload): Promise<{ message: string }> {
  const response = await fetch('/api/client-manager/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Create event failed with status ${response.status}`
    );
  }
  return response.json();
}

async function patchCreditEvent(
  eventId: string,
  payload: CreditEventMutationPayload
): Promise<{ message: string }> {
  const response = await fetch('/api/client-manager/events', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId, ...payload }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Update event failed with status ${response.status}`
    );
  }
  return response.json();
}

async function removeCreditEvent(
  eventId: string
): Promise<{ message: string }> {
  const response = await fetch('/api/client-manager/events', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Delete event failed with status ${response.status}`
    );
  }
  return response.json();
}

async function saveClientRecord(
  draft: ClientRecordDraft
): Promise<{ message: string; client: { id: string } }> {
  const response = await fetch('/api/invoices/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: draft.id || undefined,
      name: draft.name,
      billingDetails: draft.billingDetails,
      email: draft.email,
      phone: draft.phone,
      taxId: draft.taxId,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
    client?: { id?: string };
  } | null;
  if (!response.ok || !body?.client?.id) {
    throw new Error(body?.error ?? 'Unable to save the client record.');
  }
  return { message: body.message ?? 'Client record saved.', client: { id: body.client.id } };
}

async function uploadClientDocument(payload: {
  clientId: string;
  file: File;
  category: DocumentCategory;
  year: string;
}): Promise<{ message: string }> {
  const formData = new FormData();
  formData.set('clientId', payload.clientId);
  formData.set('file', payload.file);
  formData.set('category', payload.category);
  if (payload.year) formData.set('year', payload.year);
  const response = await fetch('/api/client-manager/documents', {
    method: 'POST',
    body: formData,
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? 'Unable to store document.');
  }
  return { message: body?.message ?? 'Document stored.' };
}

function getClientYearRange(client: ClientWithDocuments): string {
  if (client.first_seen_year && client.last_seen_year) {
    if (client.first_seen_year === client.last_seen_year) {
      return String(client.first_seen_year);
    }
    return `${client.first_seen_year} - ${client.last_seen_year}`;
  }
  if (client.first_seen_year) return String(client.first_seen_year);
  if (client.last_seen_year) return String(client.last_seen_year);
  return 'Unknown';
}

export function ClientManagerDashboard({
  initialClientId = null,
}: {
  initialClientId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<FiltersState>({
    search: '',
    year: 'all',
    category: 'all',
  });
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    initialClientId
  );
  const [clientSort, setClientSort] = useState<ClientSort>('name');
  const clientDialogRef = useRef<HTMLDialogElement>(null);
  const creditEventDialogRef = useRef<HTMLDialogElement>(null);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [creditEventDialogOpen, setCreditEventDialogOpen] = useState(false);
  const [clientDraft, setClientDraft] = useState<ClientRecordDraft>(
    createClientRecordDraft
  );
  const [creditStatus, setCreditStatus] = useState('');
  const [creditDraft, setCreditDraft] =
    useState<CreditEventDraft>(createCreditEventDraft);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<CreditEventDraft | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] =
    useState<DocumentCategory>('other');
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()));
  const [documentGroup, setDocumentGroup] = useState<
    'results' | 'administrative'
  >('results');

  const clientManagerQuery = useQuery({
    queryKey: ['client-manager', filters],
    queryFn: () => fetchClientManagerData(filters),
  });

  const createEventMutation = useMutation({
    mutationFn: createCreditEvent,
    onError: (error: Error) => setCreditStatus(error.message),
    onSuccess: async (payload) => {
      setCreditStatus(payload.message);
      setCreditDraft(createCreditEventDraft());
      setCreditEventDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['client-manager'] });
    },
  });

  const patchEventMutation = useMutation({
    mutationFn: ({
      eventId,
      payload,
    }: {
      eventId: string;
      payload: CreditEventMutationPayload;
    }) => patchCreditEvent(eventId, payload),
    onError: (error: Error) => setCreditStatus(error.message),
    onSuccess: async (payload) => {
      setCreditStatus(payload.message);
      setEditingEventId(null);
      setEditDraft(null);
      await queryClient.invalidateQueries({ queryKey: ['client-manager'] });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: removeCreditEvent,
    onError: (error: Error) => setCreditStatus(error.message),
    onSuccess: async (payload) => {
      setCreditStatus(payload.message);
      await queryClient.invalidateQueries({ queryKey: ['client-manager'] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadClientDocument,
    onError: (error: Error) => setCreditStatus(error.message),
    onSuccess: async (payload) => {
      setCreditStatus(payload.message);
      setUploadFile(null);
      await queryClient.invalidateQueries({ queryKey: ['client-manager'] });
    },
  });

  const saveClientMutation = useMutation({
    mutationFn: saveClientRecord,
    onError: (error: Error) => setCreditStatus(error.message),
    onSuccess: async (payload) => {
      setCreditStatus(payload.message);
      setSelectedClientId(payload.client.id);
      setClientDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['client-manager'] });
    },
  });

  const data = clientManagerQuery.data;
  const clients = useMemo(() => {
    const sortedClients = [...(data?.clients ?? [])];

    sortedClients.sort((firstClient, secondClient) => {
      if (clientSort === 'updated') {
        const updatedDifference =
          new Date(secondClient.updated_at).getTime() -
          new Date(firstClient.updated_at).getTime();
        if (updatedDifference !== 0) return updatedDifference;
      }

      return firstClient.name.localeCompare(secondClient.name, undefined, {
        sensitivity: 'base',
      });
    });

    return sortedClients;
  }, [clientSort, data?.clients]);

  useEffect(() => {
    if (clients.length === 0) {
      setSelectedClientId(null);
      return;
    }
    if (!clients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  useEffect(() => {
    const dialog = clientDialogRef.current;
    if (!dialog) return;
    if (clientDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!clientDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [clientDialogOpen]);

  useEffect(() => {
    const dialog = creditEventDialogRef.current;
    if (!dialog) return;
    if (creditEventDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!creditEventDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [creditEventDialogOpen]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  const allDocuments = selectedClient?.documents ?? data?.documents ?? [];
  const resultDocuments = allDocuments.filter(
    (document) => document.category === 'analysis'
  );
  const administrativeDocuments = allDocuments.filter(
    (document) => document.category !== 'analysis'
  );
  const documentsToDisplay =
    documentGroup === 'results' ? resultDocuments : administrativeDocuments;
  const creditEvents =
    selectedClient?.credit_events ?? data?.creditEvents ?? [];

  function openClientRecord(client?: ClientWithDocuments) {
    if (client) setSelectedClientId(client.id);
    setClientDraft(createClientRecordDraft(client));
    setClientDialogOpen(true);
  }

  function submitClientRecord() {
    if (!clientDraft.name.trim()) {
      setCreditStatus('Client name is required.');
      return;
    }
    saveClientMutation.mutate(clientDraft);
  }

  function openCreditEventDialog() {
    if (!selectedClient) {
      setCreditStatus('Select a client first.');
      return;
    }
    setCreditDraft(createCreditEventDraft());
    setCreditEventDialogOpen(true);
  }

  function submitCreditEvent() {
    if (!selectedClient) {
      setCreditStatus('Select a client first.');
      return;
    }

    createEventMutation.mutate({
      clientId: selectedClient.id,
      eventType: normalizeCreditEventType(creditDraft.eventType),
      eventDate: creditDraft.eventDate || null,
      analysesCount: parseNullableNumber(creditDraft.analysesCount),
      equipment: creditDraft.equipment.trim() || null,
      unitCost: parseNullableNumber(creditDraft.unitCost),
      amount: parseNullableNumber(creditDraft.amount),
      comment: creditDraft.comment.trim() || null,
    });
  }

  function updateCreditDraft(
    setDraft: Dispatch<SetStateAction<CreditEventDraft>>,
    field: keyof CreditEventDraft,
    value: string
  ) {
    setDraft((previous) =>
      field === 'eventType'
        ? { ...previous, eventType: normalizeCreditEventType(value) }
        : { ...previous, [field]: value }
    );
  }

  function startEditingEvent(event: (typeof creditEvents)[number]) {
    setEditingEventId(event.id);
    setEditDraft({
      eventDate: event.event_date ?? '',
      eventType: event.event_type,
      analysesCount:
        event.analyses_count === null ? '' : String(event.analyses_count),
      equipment: event.equipment ?? '',
      unitCost: event.unit_cost === null ? '' : String(event.unit_cost),
      amount: event.amount === null ? '' : String(event.amount),
      comment: event.comment ?? '',
    });
  }

  function cancelEditingEvent() {
    setEditingEventId(null);
    setEditDraft(null);
  }

  function submitEditedEvent() {
    if (!editingEventId || !editDraft) return;

    patchEventMutation.mutate({
      eventId: editingEventId,
      payload: {
        eventType: normalizeCreditEventType(editDraft.eventType),
        eventDate: editDraft.eventDate || null,
        analysesCount: parseNullableNumber(editDraft.analysesCount),
        equipment: editDraft.equipment.trim() || null,
        unitCost: parseNullableNumber(editDraft.unitCost),
        amount: parseNullableNumber(editDraft.amount),
        comment: editDraft.comment.trim() || null,
      },
    });
  }

  function deleteEvent(eventId: string) {
    if (!window.confirm('Delete this manual credit event?')) return;
    if (eventId === editingEventId) cancelEditingEvent();
    deleteEventMutation.mutate(eventId);
  }

  function submitDocumentUpload() {
    if (!selectedClient || !uploadFile) {
      setCreditStatus('Select a client and document first.');
      return;
    }
    uploadMutation.mutate({
      clientId: selectedClient.id,
      file: uploadFile,
      category: uploadCategory,
      year: uploadYear,
    });
  }

  return (
    <div className="space-y-5">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link
          href="/"
          className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Overview
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="font-medium text-foreground">
          Clients
        </span>
      </nav>

      <PageHeader
        eyebrow="Client work"
        title="Clients"
        description="Manage client records, indexed documents, and the credit ledger used for laboratory analyses."
        actions={
          <StatusPill
            tone={
              data?.source === 'local' || data?.source === 'supabase'
                ? 'success'
                : 'warning'
            }
          >
            {data?.source === 'local'
              ? 'Embedded PostgreSQL'
              : data?.source === 'supabase'
                ? 'Supabase'
                : 'Filesystem preview'}
          </StatusPill>
        }
      />

      {data?.warnings?.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950">
          {data.warnings.map((warning) => (
            <p
              key={warning}
              className="text-xs text-amber-800 dark:text-amber-200"
            >
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      {creditStatus ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {creditStatus}
        </p>
      ) : null}

      <Toolbar>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, search: event.target.value }))
              }
              placeholder="Search clients or files"
              className="pl-9"
            />
          </div>
          <select
            value={filters.year}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, year: event.target.value }))
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All years</option>
            {(data?.availableYears ?? []).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                category: event.target.value as FiltersState['category'],
              }))
            }
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All categories</option>
            {(data?.availableCategories ?? []).map((category) => (
              <option key={category} value={category}>
                {categoryLabel[category]}
              </option>
            ))}
          </select>
        </div>
      </Toolbar>

      {clientManagerQuery.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            {(clientManagerQuery.error as Error).message}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">Clients</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openClientRecord()}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add client
              </Button>
            </div>
            <div
              className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5"
              aria-label="Sort clients"
              role="group"
            >
              <Button
                size="sm"
                variant={clientSort === 'name' ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-[11px]"
                onClick={() => setClientSort('name')}
                aria-pressed={clientSort === 'name'}
                title="Order clients by name"
              >
                <ArrowDownAZ className="mr-1 h-3.5 w-3.5" />
                Name
              </Button>
              <Button
                size="sm"
                variant={clientSort === 'updated' ? 'secondary' : 'ghost'}
                className="h-7 px-2 text-[11px]"
                onClick={() => setClientSort('updated')}
                aria-pressed={clientSort === 'updated'}
                title="Order clients by latest modified"
              >
                <Clock3 className="mr-1 h-3.5 w-3.5" />
                Latest modified
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-[760px] space-y-2 overflow-y-auto">
            {clients.map((client) => (
              <div
                key={client.id}
                className={cn(
                  'flex items-start gap-1 rounded-lg border p-1 transition-colors',
                  selectedClientId === client.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40'
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className="min-w-0 flex-1 rounded-md p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-tight">{client.name}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      {client.current_credit_balance !== null &&
                      client.current_credit_balance > 0 ? (
                        <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Credit available
                        </Badge>
                      ) : null}
                      <Badge variant="outline">{client.total_documents}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Years: {getClientYearRange(client)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Balance: {formatCurrency(client.current_credit_balance)}
                  </p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openClientRecord(client)}
                  aria-label={`Edit ${client.name}`}
                  title={`Edit ${client.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Credit Ledger {selectedClient ? `- ${selectedClient.name}` : ''}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Current balance:{' '}
                  <span className="font-medium text-foreground">
                    {formatCurrency(
                      selectedClient?.current_credit_balance ?? null
                    )}
                  </span>
                </p>
                <Button
                  size="sm"
                  onClick={openCreditEventDialog}
                  disabled={!selectedClient}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add event
                </Button>
              </div>

              {editingEventId && editDraft ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Edit manual event</p>
                      <p className="text-xs text-muted-foreground">
                        Update the ledger details, then save your changes.
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={cancelEditingEvent}
                      aria-label="Cancel editing event"
                      title="Cancel editing"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <CreditEventFormFields
                    draft={editDraft}
                    idPrefix="edit-credit-event"
                    onChange={(field, value) =>
                      setEditDraft((previous) =>
                        previous
                          ? field === 'eventType'
                            ? { ...previous, eventType: value as CreditEventType }
                            : { ...previous, [field]: value }
                          : previous
                      )
                    }
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" onClick={cancelEditingEvent}>
                      Cancel
                    </Button>
                    <Button
                      onClick={submitEditedEvent}
                      disabled={patchEventMutation.isPending}
                    >
                      {patchEventMutation.isPending ? 'Saving...' : 'Save changes'}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Table
                containerClassName="max-h-[320px] border"
                className="min-w-[1060px]"
              >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Analyses</TableHead>
                      <TableHead>Equipment</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditEvents.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="text-center text-muted-foreground"
                        >
                          No credit events.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {creditEvents.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{formatDate(event.event_date)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {creditEventTypeLabel[event.event_type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {event.analyses_count ?? '-'}
                        </TableCell>
                        <TableCell>{event.equipment ?? '-'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(event.unit_cost)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={cn(
                              'font-medium tabular-nums',
                              (event.amount ?? 0) < 0
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-emerald-700 dark:text-emerald-300'
                            )}
                          >
                            {formatSignedCurrency(event.amount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(event.balance_after)}
                        </TableCell>
                        <TableCell>{event.comment ?? '-'}</TableCell>
                        <TableCell>
                          {event.source_document_id ? (
                            <a
                              href={`/api/client-manager/documents/${event.source_document_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              Workbook row {event.source_row ?? '—'}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Manual
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {event.source_type === 'manual' ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => startEditingEvent(event)}
                                disabled={
                                  patchEventMutation.isPending ||
                                  deleteEventMutation.isPending
                                }
                                aria-label="Edit credit event"
                                title="Edit credit event"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteEvent(event.id)}
                                disabled={deleteEventMutation.isPending}
                                aria-label="Delete credit event"
                                title="Delete credit event"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Source locked
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">
                  Documents {selectedClient ? `— ${selectedClient.name}` : ''}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Result workbooks are kept apart from invoices, fiscal notes,
                  quotations, and other administrative records.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div
                  className="flex rounded-md border bg-muted/30 p-0.5"
                  role="group"
                  aria-label="Document type"
                >
                  <Button
                    size="sm"
                    variant={documentGroup === 'results' ? 'secondary' : 'ghost'}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setDocumentGroup('results')}
                  >
                    Results {resultDocuments.length}
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      documentGroup === 'administrative' ? 'secondary' : 'ghost'
                    }
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setDocumentGroup('administrative')}
                  >
                    Administrative {administrativeDocuments.length}
                  </Button>
                </div>
                {selectedClient ? (
                  <Button size="sm" asChild>
                    <Link href={`/clients/${selectedClient.id}/invoices/new`}>
                      <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
                      Add invoice
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
                    Add invoice
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid gap-2 border-b bg-slate-50/70 p-3 dark:bg-slate-900/40 sm:grid-cols-[minmax(0,1fr)_130px_100px_auto]">
                <Input
                  type="file"
                  onChange={(event) =>
                    setUploadFile(event.target.files?.[0] ?? null)
                  }
                  className="bg-background"
                />
                <select
                  value={uploadCategory}
                  onChange={(event) =>
                    setUploadCategory(event.target.value as DocumentCategory)
                  }
                  className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {Object.entries(categoryLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  value={uploadYear}
                  min={2000}
                  max={2100}
                  onChange={(event) => setUploadYear(event.target.value)}
                />
                <Button
                  onClick={submitDocumentUpload}
                  disabled={!selectedClient || !uploadFile || uploadMutation.isPending}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Store
                </Button>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documentsToDisplay.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground"
                        >
                          No documents.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {documentsToDisplay.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell>
                          <a
                            href={`/api/client-manager/documents/${document.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                          >
                            {document.file_name}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <p className="text-xs text-muted-foreground">
                            {document.relative_path}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {document.category === 'analysis'
                              ? 'Result file'
                              : categoryLabel[document.category]}
                          </Badge>
                        </TableCell>
                        <TableCell>{document.year ?? '-'}</TableCell>
                        <TableCell>
                          {formatDate(document.inferred_document_date)}
                        </TableCell>
                        <TableCell className="text-right">
                          {document.category === 'analysis' ? (
                            <Button size="sm" variant="outline" asChild>
                              <a
                                href={`/results?sourceDocumentId=${encodeURIComponent(document.id)}`}
                                aria-label={`Visualize ${document.file_name} in Results`}
                              >
                                <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                                Visualize
                              </a>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <dialog
        ref={creditEventDialogRef}
        onCancel={(event) => {
          event.preventDefault();
          setCreditEventDialogOpen(false);
        }}
        aria-labelledby="credit-event-title"
        className="w-[calc(100%-1.5rem)] max-w-5xl rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-slate-950/45 dark:backdrop:bg-slate-950/70"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitCreditEvent();
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <h2 id="credit-event-title" className="text-lg font-semibold">
                Add ledger event
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Top-ups are positive credit; analyses are negative adjustments.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setCreditEventDialogOpen(false)}
              aria-label="Close add event"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-5 py-4">
            <CreditEventFormFields
              draft={creditDraft}
              idPrefix="add-credit-event"
              onChange={(field, value) =>
                updateCreditDraft(setCreditDraft, field, value)
              }
            />
          </div>

          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreditEventDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createEventMutation.isPending}>
              {createEventMutation.isPending ? 'Adding...' : 'Add event'}
            </Button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={clientDialogRef}
        onCancel={(event) => {
          event.preventDefault();
          setClientDialogOpen(false);
        }}
        aria-labelledby="client-record-title"
        className="w-[calc(100%-1.5rem)] max-w-xl rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-slate-950/45 dark:backdrop:bg-slate-950/70"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitClientRecord();
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <h2 id="client-record-title" className="text-lg font-semibold">
                {clientDraft.id ? 'Edit client record' : 'Add client'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                These billing details are available when generating invoices.
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setClientDialogOpen(false)}
              aria-label="Close client record"
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Client name</span>
              <Input
                value={clientDraft.name}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Client or institution name"
                required
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Billing address and details</span>
              <textarea
                value={clientDraft.billingDetails}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    billingDetails: event.target.value,
                  }))
                }
                placeholder="Address, city, country, department, and billing identifiers"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Email</span>
              <Input
                type="email"
                value={clientDraft.email}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="billing@example.org"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Phone</span>
              <Input
                value={clientDraft.phone}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="+55 ..."
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-medium">Tax ID</span>
              <Input
                value={clientDraft.taxId}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    taxId: event.target.value,
                  }))
                }
                placeholder="CPF, CNPJ, VAT, or institutional tax ID"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setClientDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveClientMutation.isPending}>
              {saveClientMutation.isPending ? 'Saving...' : 'Save client'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
