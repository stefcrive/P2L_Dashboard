'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FilePlus2,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';

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
  fallbackInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoices/settings';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  fetchResource,
  selectClassName,
  textareaClassName,
  updateResource,
} from '@/lib/operations/client';

type Client = {
  id: string;
  name: string;
  billing_details: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
};

type Invoice = {
  id: string;
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  subtotal: number;
  tax_amount: number;
  tax_percent: number;
  total_amount: number;
  currency: string;
  paid_at: string | null;
  notes: string | null;
  language: 'en' | 'pt';
  payment_instructions: 'national' | 'international' | 'both';
  pdf_document_id: string | null;
  client: Pick<Client, 'id' | 'name'> | null;
};

type InvoiceItemDraft = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

const today = new Date().toISOString().slice(0, 10);
const expirationDate = new Date(Date.now() + 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function createItem(): InvoiceItemDraft {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    description: '',
    quantity: '1',
    unitPrice: '',
  };
}

const initialDraft = {
  clientId: '',
  clientName: '',
  clientDetails: '',
  clientEmail: '',
  clientPhone: '',
  clientTaxId: '',
  invoiceNumber: '',
  language: 'en' as 'en' | 'pt',
  currency: 'BRL',
  issueDate: today,
  dueDate: expirationDate,
  taxPercent: '0',
  serviceDescription: '',
  additionalInfo: '',
  issuerDetails: fallbackInvoiceSettings.issuer_details,
  paymentInstructions: 'both' as 'national' | 'international' | 'both',
  nationalPaymentDetails: '',
  internationalPaymentDetails: '',
  footerNote: fallbackInvoiceSettings.footer_note,
};

function draftWithSettings(settings: InvoiceSettings) {
  return {
    ...initialDraft,
    language: settings.default_language,
    currency: settings.default_currency,
    issuerDetails: settings.issuer_details,
    paymentInstructions: settings.default_payment_instructions,
    nationalPaymentDetails: settings.national_payment_details,
    internationalPaymentDetails: settings.international_payment_details,
    footerNote: settings.footer_note,
  };
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}

function invoiceTone(status: Invoice['status']) {
  if (status === 'paid') return 'success' as const;
  if (status === 'overdue' || status === 'cancelled') return 'danger' as const;
  if (status === 'sent') return 'primary' as const;
  return 'warning' as const;
}

function generatedInvoiceNumber(issueDate: string, mode: 'preview' | 'issue') {
  if (mode === 'preview') return 'DRAFT-PREVIEW';
  const datePart =
    issueDate.replace(/\D/g, '').slice(0, 8) ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${datePart}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function validateInvoiceDraft(
  draft: typeof initialDraft,
  items: InvoiceItemDraft[]
) {
  const missing: Array<{ label: string; fieldId: string }> = [];
  if (!draft.clientName.trim()) {
    missing.push({ label: 'client name', fieldId: 'invoice-client-name' });
  }
  if (!draft.issueDate) {
    missing.push({ label: 'emission date', fieldId: 'invoice-issue-date' });
  }
  if (!draft.dueDate) {
    missing.push({ label: 'expiration date', fieldId: 'invoice-due-date' });
  }
  if (!/^[A-Z]{3}$/.test(draft.currency.trim().toUpperCase())) {
    missing.push({
      label: 'three-letter currency',
      fieldId: 'invoice-currency',
    });
  }
  if (
    !items.some(
      (item) =>
        item.description.trim() &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) > 0 &&
        Number.isFinite(Number(item.unitPrice)) &&
        Number(item.unitPrice) >= 0
    )
  ) {
    missing.push({
      label: 'at least one complete invoice item',
      fieldId: 'invoice-item-0-description',
    });
  }
  if (!draft.issuerDetails.trim()) {
    missing.push({
      label: 'issuer details',
      fieldId: 'invoice-issuer-details',
    });
  }
  return missing;
}

function showPreviewWindowState(
  previewWindow: Window,
  title: string,
  detail: string,
  error = false
) {
  const document = previewWindow.document;
  document.title = title;
  document.head.replaceChildren();
  document.body.replaceChildren();
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    main { width: min(32rem, calc(100% - 3rem)); padding: 2rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; background: white; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0; font-size: 1.25rem; line-height: 1.4; }
    p { margin: 0.75rem 0 0; color: ${error ? '#b91c1c' : '#475569'}; line-height: 1.6; }
  `;
  const main = document.createElement('main');
  const heading = document.createElement('h1');
  const paragraph = document.createElement('p');
  heading.textContent = title;
  paragraph.textContent = detail;
  main.append(heading, paragraph);
  document.head.append(style);
  document.body.append(main);
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'The operation could not be completed.');
  }
  return payload;
}

async function fetchInvoiceSettings(): Promise<InvoiceSettings> {
  const response = await fetch('/api/invoice-settings', { cache: 'no-store' });
  const payload = await readJson(response);
  return payload.data;
}

export type FinanceDashboardView = 'ledger' | 'create';

function FinanceBreadcrumb({
  view,
  clientId,
  clientName,
}: {
  view: FinanceDashboardView;
  clientId?: string;
  clientName?: string;
}) {
  return (
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
      {view === 'create' ? (
        <>
          <Link
            href="/clients"
            className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clients
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={{
              pathname: '/clients',
              query: clientId ? { clientId } : undefined,
            }}
            className="max-w-52 truncate rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {clientName || 'Client record'}
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-foreground">
            Add invoice
          </span>
        </>
      ) : (
        <span aria-current="page" className="font-medium text-foreground">
          Invoices
        </span>
      )}
    </nav>
  );
}

export function FinanceDashboard({
  view = 'ledger',
  clientId,
}: {
  view?: FinanceDashboardView;
  clientId?: string;
}) {
  const isCreateView = view === 'create';
  const queryClient = useQueryClient();
  const settingsApplied = useRef(false);
  const clientApplied = useRef(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(initialDraft);
  const [items, setItems] = useState<InvoiceItemDraft[]>([createItem()]);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'preview' | 'issue' | null>(null);

  const clientsQuery = useQuery({
    queryKey: ['operations', 'clients'],
    queryFn: () => fetchResource<Client>('clients'),
    retry: false,
  });
  const invoicesQuery = useQuery({
    queryKey: ['operations', 'invoices'],
    queryFn: () => fetchResource<Invoice>('invoices'),
    enabled: !isCreateView,
    retry: false,
  });
  const settingsQuery = useQuery({
    queryKey: ['invoice-settings'],
    queryFn: fetchInvoiceSettings,
    retry: false,
  });

  useEffect(() => {
    if (!settingsQuery.data || settingsApplied.current) return;
    settingsApplied.current = true;
    setDraft((current) => ({
      ...current,
      language: settingsQuery.data.default_language,
      currency: settingsQuery.data.default_currency,
      issuerDetails: settingsQuery.data.issuer_details,
      paymentInstructions: settingsQuery.data.default_payment_instructions,
      nationalPaymentDetails: settingsQuery.data.national_payment_details,
      internationalPaymentDetails:
        settingsQuery.data.international_payment_details,
      footerNote: settingsQuery.data.footer_note,
    }));
  }, [settingsQuery.data]);

  const saveClientMutation = useMutation({
    mutationFn: async () =>
      readJson(
        await fetch('/api/invoices/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: draft.clientId || undefined,
            name: draft.clientName,
            billingDetails: draft.clientDetails,
            email: draft.clientEmail,
            phone: draft.clientPhone,
            taxId: draft.clientTaxId,
          }),
        })
      ),
    onSuccess: async (payload) => {
      setDraft((current) => ({ ...current, clientId: payload.client.id }));
      setMessage(payload.message);
      setMessageIsError(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operations', 'clients'] }),
        queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
      ]);
    },
    onError: (error: Error) => {
      setMessage(error.message);
      setMessageIsError(true);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Invoice['status'] }) =>
      updateResource<Invoice>('invoices', id, {
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : null,
      }),
    onSuccess: async (_, variables) => {
      setMessage(`Invoice marked ${variables.status}.`);
      setMessageIsError(false);
      await queryClient.invalidateQueries({
        queryKey: ['operations', 'invoices'],
      });
    },
    onError: (error: Error) => {
      setMessage(error.message);
      setMessageIsError(true);
    },
  });

  const clients = clientsQuery.data ?? [];
  const scopedClient = clientId
    ? clients.find((client) => client.id === clientId)
    : undefined;

  useEffect(() => {
    if (!clientId || clientApplied.current || !clientsQuery.data) return;
    clientApplied.current = true;
    const client = clientsQuery.data.find((value) => value.id === clientId);
    if (!client) {
      setMessage('This client record could not be found.');
      setMessageIsError(true);
      return;
    }
    setDraft((current) => ({
      ...current,
      clientId: client.id,
      clientName: client.name,
      clientDetails: client.billing_details ?? '',
      clientEmail: client.email ?? '',
      clientPhone: client.phone ?? '',
      clientTaxId: client.tax_id ?? '',
    }));
  }, [clientId, clientsQuery.data]);

  const invoices = useMemo(
    () => invoicesQuery.data ?? [],
    [invoicesQuery.data]
  );
  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return invoices;
    return invoices.filter((invoice) =>
      [invoice.invoice_number, invoice.client?.name, invoice.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [invoices, search]);

  const subtotal = items.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );
  const taxAmount = subtotal * (Number(draft.taxPercent || 0) / 100);
  const amountDue = subtotal + taxAmount;

  function chooseClient(clientId: string) {
    const client = clients.find((value) => value.id === clientId);
    if (!client) {
      setDraft((current) => ({
        ...current,
        clientId: '',
        clientName: '',
        clientDetails: '',
        clientEmail: '',
        clientPhone: '',
        clientTaxId: '',
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      clientId: client.id,
      clientName: client.name,
      clientDetails: client.billing_details ?? '',
      clientEmail: client.email ?? '',
      clientPhone: client.phone ?? '',
      clientTaxId: client.tax_id ?? '',
    }));
  }

  function updateItem(
    itemId: string,
    field: keyof Omit<InvoiceItemDraft, 'id'>,
    value: string
  ) {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  }

  function buildPdfPayload(mode: 'preview' | 'issue') {
    return {
      mode,
      clientId: draft.clientId || undefined,
      clientName: draft.clientName,
      clientDetails: draft.clientDetails,
      clientEmail: draft.clientEmail,
      clientPhone: draft.clientPhone,
      clientTaxId: draft.clientTaxId,
      invoiceNumber:
        draft.invoiceNumber.trim() ||
        generatedInvoiceNumber(draft.issueDate, mode),
      language: draft.language,
      currency: draft.currency,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      taxPercent: Number(draft.taxPercent || 0),
      items: items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
      })),
      serviceDescription: draft.serviceDescription,
      additionalInfo: draft.additionalInfo,
      issuerDetails: draft.issuerDetails,
      paymentInstructions: draft.paymentInstructions,
      nationalPaymentDetails: draft.nationalPaymentDetails,
      internationalPaymentDetails: draft.internationalPaymentDetails,
      footerNote: draft.footerNote,
    };
  }

  async function createPdf(mode: 'preview' | 'issue') {
    const validationProblems = validateInvoiceDraft(draft, items);
    if (validationProblems.length) {
      setMessage(
        `Complete the required fields: ${validationProblems
          .map((problem) => problem.label)
          .join(', ')}.`
      );
      setMessageIsError(true);
      document.getElementById(validationProblems[0].fieldId)?.focus();
      return;
    }

    const previewWindow = mode === 'preview' ? window.open('', '_blank') : null;
    if (mode === 'preview' && !previewWindow) {
      setMessage(
        'The browser blocked the preview tab. Allow pop-ups for this dashboard and try again.'
      );
      setMessageIsError(true);
      return;
    }
    if (previewWindow) {
      previewWindow.opener = null;
      showPreviewWindowState(
        previewWindow,
        'Preparing invoice preview',
        'The PDF is being generated. This tab will update automatically.'
      );
    }
    setPdfBusy(mode);
    setMessage('');
    setMessageIsError(false);
    try {
      const response = await fetch('/api/invoices/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPdfPayload(mode)),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'Unable to create invoice PDF.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (mode === 'preview') {
        if (previewWindow) previewWindow.location.href = url;
        else window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setMessage('Invoice preview created without saving records.');
        setMessageIsError(false);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${draft.invoiceNumber || 'invoice'}.pdf`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setMessage(
          'Invoice issued, archived in the client record, and downloaded.'
        );
        setMessageIsError(false);
        setDraft((current) => ({
          ...draftWithSettings(settingsQuery.data ?? fallbackInvoiceSettings),
          clientId: current.clientId,
          clientName: current.clientName,
          clientDetails: current.clientDetails,
          clientEmail: current.clientEmail,
          clientPhone: current.clientPhone,
          clientTaxId: current.clientTaxId,
        }));
        setItems([createItem()]);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['operations', 'invoices'],
          }),
          queryClient.invalidateQueries({
            queryKey: ['operations', 'clients'],
          }),
          queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
          queryClient.invalidateQueries({
            queryKey: ['operations-header-summary'],
          }),
        ]);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unable to create invoice PDF.';
      if (previewWindow && !previewWindow.closed) {
        showPreviewWindowState(
          previewWindow,
          'Invoice preview could not be created',
          errorMessage,
          true
        );
      }
      setMessage(errorMessage);
      setMessageIsError(true);
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <FinanceBreadcrumb
        view={view}
        clientId={clientId}
        clientName={scopedClient?.name || draft.clientName}
      />
      <PageHeader
        title={isCreateView ? 'Add invoice' : 'Invoices'}
        description={
          isCreateView
            ? 'Prepare a branded PDF invoice and archive it against the client record.'
            : 'Follow payment status from the invoice ledger, or create a new invoice.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isCreateView ? (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={
                    clientId
                      ? `/clients?clientId=${encodeURIComponent(clientId)}`
                      : '/clients'
                  }
                >
                  Back to client
                </Link>
              </Button>
            ) : (
              <Button size="sm" asChild>
                <Link href="/clients">
                  <FilePlus2 className="mr-1.5 h-4 w-4" />
                  Select a client
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings">
                <Settings2 className="mr-1.5 h-4 w-4" />
                Invoice settings
              </Link>
            </Button>
          </div>
        }
      />

      {clientsQuery.isError || (!isCreateView && invoicesQuery.isError) ? (
        <EmptyState
          error
          title="Invoice records could not be loaded"
          description={
            (invoicesQuery.error as Error | null)?.message ??
            (clientsQuery.error as Error | null)?.message ??
            'Start the local database and try again.'
          }
        />
      ) : (
        <>
          {isCreateView && clientId && clientsQuery.data && !scopedClient ? (
            <EmptyState
              error
              title="Client record not found"
              description="Return to Clients and select a client before adding an invoice."
            />
          ) : isCreateView ? (
            <SectionPanel
              title="Create PDF invoice"
              description="Preview without saving, or issue to create the invoice, client document, and downloadable PDF."
              actions={
                <StatusPill
                  tone={draft.language === 'pt' ? 'success' : 'primary'}
                >
                  {draft.language === 'pt' ? 'Português' : 'English'}
                </StatusPill>
              }
              bodyClassName="p-0"
            >
              <div className="space-y-0 divide-y">
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <label className="block text-xs font-medium">
                    Saved client
                    <select
                      value={draft.clientId}
                      onChange={(event) => chooseClient(event.target.value)}
                      disabled={Boolean(clientId)}
                      className={`${selectClassName} mt-1`}
                    >
                      <option value="">
                        {clientId ? 'Loading client…' : 'New client'}
                      </option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium">
                      Language
                      <select
                        value={draft.language}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            language: event.target.value as 'en' | 'pt',
                          }))
                        }
                        className={`${selectClassName} mt-1`}
                      >
                        <option value="en">English</option>
                        <option value="pt">Português</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium">
                      Currency
                      <Input
                        id="invoice-currency"
                        value={draft.currency}
                        maxLength={3}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            currency: event.target.value.toUpperCase(),
                          }))
                        }
                        className="mt-1 uppercase"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium lg:col-span-2">
                    Client name
                    <Input
                      id="invoice-client-name"
                      value={draft.clientName}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          clientName: event.target.value,
                        }))
                      }
                      placeholder="Client or institution name"
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium lg:col-span-2">
                    Client details
                    <textarea
                      value={draft.clientDetails}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          clientDetails: event.target.value,
                        }))
                      }
                      placeholder="Address, city, country, and any billing identifiers"
                      className={`${textareaClassName} mt-1 min-h-20`}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Email
                    <Input
                      type="email"
                      value={draft.clientEmail}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          clientEmail: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3">
                    <label className="block text-xs font-medium">
                      Phone
                      <Input
                        value={draft.clientPhone}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            clientPhone: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block text-xs font-medium">
                      Tax ID
                      <Input
                        value={draft.clientTaxId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            clientTaxId: event.target.value,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <Button
                      variant="outline"
                      className="mt-5"
                      onClick={() => saveClientMutation.mutate()}
                      disabled={
                        !draft.clientName.trim() || saveClientMutation.isPending
                      }
                    >
                      <Save className="mr-1.5 h-4 w-4" />
                      Save client
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-xs font-medium">
                    Invoice number (optional)
                    <Input
                      value={draft.invoiceNumber}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          invoiceNumber: event.target.value,
                        }))
                      }
                      placeholder="Generated automatically"
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Emission date
                    <Input
                      id="invoice-issue-date"
                      type="date"
                      value={draft.issueDate}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          issueDate: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Expiration date
                    <Input
                      id="invoice-due-date"
                      type="date"
                      value={draft.dueDate}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                      className="mt-1"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Tax
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.taxPercent}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            taxPercent: event.target.value,
                          }))
                        }
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </label>
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base font-semibold">
                        Items
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Quantity and unit price calculate the invoice total.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setItems((current) => [...current, createItem()])
                      }
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add item
                    </Button>
                  </div>
                  {items.map((item, index) => (
                    <div
                      key={item.id}
                      className="grid gap-3 border-t pt-3 md:grid-cols-[minmax(0,1fr)_120px_160px_auto]"
                    >
                      <label className="block text-xs font-medium">
                        Description
                        <Input
                          id={`invoice-item-${index}-description`}
                          value={item.description}
                          onChange={(event) =>
                            updateItem(
                              item.id,
                              'description',
                              event.target.value
                            )
                          }
                          placeholder={
                            index === 0
                              ? 'Stable isotope analyses or technical service'
                              : 'Additional service'
                          }
                          className="mt-1"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        Quantity
                        <Input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(item.id, 'quantity', event.target.value)
                          }
                          className="mt-1"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        Unit price
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) =>
                            updateItem(item.id, 'unitPrice', event.target.value)
                          }
                          className="mt-1"
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-5"
                        onClick={() =>
                          setItems((current) =>
                            current.length === 1
                              ? [createItem()]
                              : current.filter((value) => value.id !== item.id)
                          )
                        }
                        aria-label={`Remove item ${index + 1}`}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <label className="block text-xs font-medium lg:col-span-2">
                    Service description
                    <textarea
                      value={draft.serviceDescription}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          serviceDescription: event.target.value,
                        }))
                      }
                      placeholder="Describe the analytical service, deliverables, or training scope."
                      className={`${textareaClassName} mt-1 min-h-24`}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Issuer details
                    <textarea
                      id="invoice-issuer-details"
                      value={draft.issuerDetails}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          issuerDetails: event.target.value,
                        }))
                      }
                      className={`${textareaClassName} mt-1 min-h-28`}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Additional custom info
                    <textarea
                      value={draft.additionalInfo}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          additionalInfo: event.target.value,
                        }))
                      }
                      placeholder="Terms, references, or notes"
                      className={`${textareaClassName} mt-1 min-h-28`}
                    />
                  </label>
                  <label className="block text-xs font-medium lg:col-span-2">
                    Bank details
                    <select
                      value={draft.paymentInstructions}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          paymentInstructions: event.target.value as
                            | 'national'
                            | 'international'
                            | 'both',
                        }))
                      }
                      className={`${selectClassName} mt-1`}
                    >
                      <option value="national">National</option>
                      <option value="international">International</option>
                      <option value="both">National and international</option>
                    </select>
                  </label>
                  {draft.paymentInstructions !== 'international' ? (
                    <label className="block text-xs font-medium">
                      National payment instructions
                      <textarea
                        value={draft.nationalPaymentDetails}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            nationalPaymentDetails: event.target.value,
                          }))
                        }
                        placeholder="Bank, branch, account, PIX, beneficiary, and reference"
                        className={`${textareaClassName} mt-1 min-h-28`}
                      />
                    </label>
                  ) : null}
                  {draft.paymentInstructions !== 'national' ? (
                    <label className="block text-xs font-medium">
                      International payment instructions
                      <textarea
                        value={draft.internationalPaymentDetails}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            internationalPaymentDetails: event.target.value,
                          }))
                        }
                        placeholder="Account holder, SWIFT/BIC, account, bank address, and reference"
                        className={`${textareaClassName} mt-1 min-h-28`}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="flex flex-col gap-4 bg-slate-50 p-4 dark:bg-slate-900/50 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Estimated amount due
                    </p>
                    <p className="mt-1 font-display text-2xl font-semibold tracking-[-0.02em] tabular-nums">
                      {formatMoney(amountDue, draft.currency || 'BRL')}
                    </p>
                    <p
                      className={`mt-1 min-h-4 text-[11px] ${
                        messageIsError
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      }`}
                      role={messageIsError ? 'alert' : 'status'}
                      aria-live="polite"
                    >
                      {message}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => createPdf('preview')}
                      disabled={pdfBusy !== null}
                    >
                      {pdfBusy === 'preview' ? 'Creating preview…' : 'Preview'}
                    </Button>
                    <Button
                      onClick={() => createPdf('issue')}
                      disabled={pdfBusy !== null}
                    >
                      <FilePlus2 className="mr-1.5 h-4 w-4" />
                      {pdfBusy === 'issue'
                        ? 'Issuing invoice…'
                        : 'Create PDF invoice'}
                    </Button>
                  </div>
                </div>
              </div>
            </SectionPanel>
          ) : null}

          {!isCreateView ? (
            <>
              <Toolbar>
                <div className="relative max-w-xl">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search invoice, client, or status"
                    className="pl-9"
                  />
                </div>
              </Toolbar>

              <SectionPanel
                title="Invoice ledger"
                description={`${filteredInvoices.length} invoices match the current search.`}
                bodyClassName="p-0"
              >
                {filteredInvoices.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Due</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredInvoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-mono font-medium">
                              {invoice.invoice_number}
                            </TableCell>
                            <TableCell>
                              {invoice.client?.name ?? 'Unknown client'}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums">
                              {invoice.issue_date}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums">
                              {invoice.due_date ?? '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatMoney(
                                invoice.total_amount,
                                invoice.currency
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusPill tone={invoiceTone(invoice.status)}>
                                {invoice.status}
                              </StatusPill>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                {invoice.pdf_document_id ? (
                                  <Button size="sm" variant="outline" asChild>
                                    <a
                                      href={`/api/client-manager/documents/${invoice.pdf_document_id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Download className="mr-1 h-3.5 w-3.5" />
                                      PDF
                                    </a>
                                  </Button>
                                ) : null}
                                {invoice.status === 'draft' ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: invoice.id,
                                        status: 'sent',
                                      })
                                    }
                                    disabled={statusMutation.isPending}
                                  >
                                    Mark sent
                                  </Button>
                                ) : ['sent', 'overdue'].includes(
                                    invoice.status
                                  ) ? (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      statusMutation.mutate({
                                        id: invoice.id,
                                        status: 'paid',
                                      })
                                    }
                                    disabled={statusMutation.isPending}
                                  >
                                    Mark paid
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    title="No invoices match"
                    description="Change the search or issue the first PDF invoice."
                  />
                )}
              </SectionPanel>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
