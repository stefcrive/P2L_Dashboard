'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fallbackInvoiceSettings,
  type InvoiceSettings,
} from '@/lib/invoices/settings';
import {
  selectClassName,
  textareaClassName,
} from '@/lib/operations/client';

async function readSettings(): Promise<InvoiceSettings> {
  const response = await fetch('/api/invoice-settings', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'Invoice settings could not be loaded.');
  }
  return payload.data;
}

export function InvoiceSettingsDashboard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<InvoiceSettings>(fallbackInvoiceSettings);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['invoice-settings'],
    queryFn: readSettings,
    retry: false,
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsQuery.data);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/invoice-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? 'Invoice settings could not be saved.');
      }
      return payload as { data: InvoiceSettings; message: string };
    },
    onSuccess: async (payload) => {
      setForm(payload.data);
      setMessage(payload.message);
      setMessageIsError(false);
      await queryClient.invalidateQueries({ queryKey: ['invoice-settings'] });
    },
    onError: (error: Error) => {
      setMessage(error.message);
      setMessageIsError(true);
    },
  });

  if (settingsQuery.isError) {
    return (
      <EmptyState
        error
        title="Invoice settings could not be loaded"
        description={
          (settingsQuery.error as Error).message ??
          'Start the application database and try again.'
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Invoice settings"
        description="Save the issuing organisation and payment instructions used as defaults for every new invoice."
        actions={
          <StatusPill tone={settingsQuery.isFetching ? 'warning' : 'success'}>
            {settingsQuery.isFetching ? 'Loading defaults' : 'Defaults ready'}
          </StatusPill>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <SectionPanel
          title="Issued by"
          description="These legal and billing details appear in the issuer block on the PDF."
        >
          <label className="block text-xs font-medium">
            Organisation and billing details
            <textarea
              value={form.issuer_details}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  issuer_details: event.target.value,
                }))
              }
              placeholder="Legal entity, department, address, tax identifier, and contact details"
              className={`${textareaClassName} mt-1 min-h-44`}
            />
          </label>

          <label className="mt-4 block text-xs font-medium">
            Footer note
            <Input
              value={form.footer_note}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  footer_note: event.target.value,
                }))
              }
              placeholder="P2L · EACH-USP · Universidade de São Paulo"
              className="mt-1"
            />
          </label>
        </SectionPanel>

        <SectionPanel
          title="Invoice defaults"
          description="New invoice drafts start with these values and can still be changed individually."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="block text-xs font-medium">
              Language
              <select
                value={form.default_language}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_language: event.target.value as 'en' | 'pt',
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
                value={form.default_currency}
                maxLength={3}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_currency: event.target.value.toUpperCase(),
                  }))
                }
                className="mt-1 uppercase"
              />
            </label>
            <label className="block text-xs font-medium sm:col-span-2 xl:col-span-1 2xl:col-span-2">
              Payment details shown
              <select
                value={form.default_payment_instructions}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_payment_instructions: event.target.value as
                      | 'national'
                      | 'international'
                      | 'both',
                  }))
                }
                className={`${selectClassName} mt-1`}
              >
                <option value="national">National only</option>
                <option value="international">International only</option>
                <option value="both">National and international</option>
              </select>
            </label>
          </div>
        </SectionPanel>
      </div>

      <SectionPanel
        title="Ways to pay"
        description="Both blocks are printed side by side when national and international details are selected."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <label className="block text-xs font-medium">
            National payment details
            <textarea
              value={form.national_payment_details}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  national_payment_details: event.target.value,
                }))
              }
              placeholder="Bank, branch, account, PIX, beneficiary, tax ID, and payment reference"
              className={`${textareaClassName} mt-1 min-h-44`}
            />
          </label>
          <label className="block text-xs font-medium">
            International payment details
            <textarea
              value={form.international_payment_details}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  international_payment_details: event.target.value,
                }))
              }
              placeholder="Account holder, SWIFT/BIC, account or IBAN, bank address, and payment reference"
              className={`${textareaClassName} mt-1 min-h-44`}
            />
          </label>
        </div>
      </SectionPanel>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={`min-h-5 text-xs ${
            messageIsError
              ? 'font-medium text-destructive'
              : 'text-muted-foreground'
          }`}
          role={messageIsError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message ||
            'Saved values are copied into new invoice drafts; existing invoices are unchanged.'}
        </p>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !form.issuer_details.trim()}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {saveMutation.isPending ? 'Saving settings…' : 'Save invoice settings'}
        </Button>
      </div>
    </div>
  );
}
