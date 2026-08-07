import { createHash, randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { saveInvoiceClient } from '@/lib/invoices/clients';
import {
  createInvoicePdf,
  type InvoiceItemInput,
  type InvoiceLanguage,
  type InvoicePdfPayload,
  type PaymentInstructionMode,
} from '@/lib/invoices/pdf';
import { slugifyResultClient } from '@/lib/results/parser';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 120;

type RequestPayload = InvoicePdfPayload & {
  mode?: 'preview' | 'issue';
  clientId?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientTaxId?: string;
};

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'invoice';
}

function generatedInvoiceNumber(issueDate: string, mode: 'preview' | 'issue') {
  if (mode === 'preview') return 'DRAFT-PREVIEW';
  const datePart =
    issueDate.replace(/\D/g, '').slice(0, 8) ||
    new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${datePart}-${randomUUID().slice(0, 4).toUpperCase()}`;
}

function parsePayload(body: Record<string, unknown>): RequestPayload {
  const mode = body.mode === 'preview' ? 'preview' : 'issue';
  const issueDate = String(body.issueDate ?? '').trim();
  const language: InvoiceLanguage = body.language === 'pt' ? 'pt' : 'en';
  const paymentInstructions: PaymentInstructionMode = [
    'national',
    'international',
    'both',
  ].includes(String(body.paymentInstructions))
    ? (body.paymentInstructions as PaymentInstructionMode)
    : 'both';
  const items = Array.isArray(body.items)
    ? body.items
        .map((item) => {
          const value = item as Record<string, unknown>;
          return {
            description: String(value.description ?? '').trim(),
            quantity: Number(value.quantity ?? 0),
            unitPrice: Number(value.unitPrice ?? 0),
          };
        })
        .filter(
          (item): item is InvoiceItemInput =>
            Boolean(item.description) &&
            Number.isFinite(item.quantity) &&
            item.quantity > 0 &&
            Number.isFinite(item.unitPrice) &&
            item.unitPrice >= 0
        )
    : [];
  return {
    mode,
    clientId: String(body.clientId ?? '').trim() || undefined,
    clientEmail: String(body.clientEmail ?? ''),
    clientPhone: String(body.clientPhone ?? ''),
    clientTaxId: String(body.clientTaxId ?? ''),
    invoiceNumber:
      String(body.invoiceNumber ?? '').trim() ||
      generatedInvoiceNumber(issueDate, mode),
    language,
    currency: String(body.currency ?? 'BRL').trim().toUpperCase(),
    clientName: String(body.clientName ?? '').trim(),
    clientDetails: String(body.clientDetails ?? '').trim(),
    issueDate,
    dueDate: String(body.dueDate ?? '').trim(),
    taxPercent: Math.max(0, Number(body.taxPercent ?? 0)),
    items,
    serviceDescription: String(body.serviceDescription ?? '').trim(),
    additionalInfo: String(body.additionalInfo ?? '').trim(),
    issuerDetails: String(body.issuerDetails ?? '').trim(),
    paymentInstructions,
    nationalPaymentDetails: String(body.nationalPaymentDetails ?? '').trim(),
    internationalPaymentDetails: String(
      body.internationalPaymentDetails ?? ''
    ).trim(),
  };
}

function validatePayload(payload: RequestPayload) {
  const missing: string[] = [];
  if (!payload.clientName) missing.push('client name');
  if (!payload.issueDate) missing.push('issue date');
  if (!payload.dueDate) missing.push('expiration date');
  if (!payload.currency || payload.currency.length !== 3) {
    missing.push('three-letter currency');
  }
  if (!payload.items.length) missing.push('at least one invoice item');
  if (!payload.issuerDetails) missing.push('issuer details');
  if (missing.length) {
    throw new Error(`Complete the required fields: ${missing.join(', ')}.`);
  }
}

export async function POST(request: Request) {
  try {
    const payload = parsePayload(await request.json());
    validatePayload(payload);
    const pdfBytes = await createInvoicePdf(payload);
    const fileName = `${safeFileName(payload.invoiceNumber)}.pdf`;
    if (payload.mode === 'preview') {
      return new Response(pdfBytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdfBytes.byteLength),
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const client = await saveInvoiceClient({
      id: payload.clientId,
      name: payload.clientName,
      billingDetails: payload.clientDetails,
      email: payload.clientEmail,
      phone: payload.clientPhone,
      taxId: payload.clientTaxId,
    });
    const subtotal = payload.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const taxAmount = subtotal * (payload.taxPercent / 100);
    const totalAmount = subtotal + taxAmount;
    const database = getSupabaseAdminClient();
    const { data: invoice, error: invoiceError } = await database
      .from('client_invoices')
      .insert({
        client_id: client.id,
        invoice_number: payload.invoiceNumber,
        issue_date: payload.issueDate,
        due_date: payload.dueDate,
        status: 'draft',
        subtotal,
        tax_amount: taxAmount,
        tax_percent: payload.taxPercent,
        total_amount: totalAmount,
        currency: payload.currency,
        language: payload.language,
        payment_instructions: payload.paymentInstructions,
        client_name_snapshot: payload.clientName,
        client_details_snapshot: payload.clientDetails,
        service_description: payload.serviceDescription || null,
        additional_info: payload.additionalInfo || null,
        issuer_details: payload.issuerDetails,
        national_payment_details: payload.nationalPaymentDetails || null,
        international_payment_details:
          payload.internationalPaymentDetails || null,
        notes: payload.additionalInfo || null,
      })
      .select(
        'id, client_id, invoice_number, issue_date, due_date, status, subtotal, tax_amount, total_amount, currency'
      )
      .single();
    if (invoiceError || !invoice) {
      throw new Error(invoiceError?.message ?? 'Unable to save invoice.');
    }

    const itemRows = payload.items.map((item) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: item.quantity * item.unitPrice,
    }));
    const { error: itemError } = await database
      .from('invoice_items')
      .insert(itemRows);
    if (itemError) throw new Error(itemError.message);

    const year = payload.issueDate.slice(0, 4);
    const clientSlug = slugifyResultClient(payload.clientName);
    const relativePath = `Invoices/${year}/${clientSlug}/${fileName}`;
    const content =
      getApplicationDatabaseSource() === 'supabase'
        ? `\\x${Buffer.from(pdfBytes).toString('hex')}`
        : pdfBytes;
    const { data: document, error: documentError } = await database
      .from('client_documents')
      .insert({
        client_id: client.id,
        file_name: fileName,
        relative_path: relativePath,
        absolute_path: `database://${relativePath}`,
        year: Number(year),
        extension: '.pdf',
        category: 'invoice',
        inferred_document_number: payload.invoiceNumber,
        inferred_document_date: payload.issueDate,
        file_size_bytes: pdfBytes.byteLength,
        mime_type: 'application/pdf',
        content_sha256: createHash('sha256').update(pdfBytes).digest('hex'),
        content,
        storage_origin: 'upload',
      })
      .select('id')
      .single();
    if (documentError || !document) {
      throw new Error(
        documentError?.message ?? 'Invoice saved, but its PDF was not archived.'
      );
    }
    await database
      .from('client_invoices')
      .update({ pdf_document_id: document.id })
      .eq('id', invoice.id);
    const { count: documentCount } = await database
      .from('client_documents')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id);
    await database
      .from('clients')
      .update({ total_documents: documentCount ?? 0 })
      .eq('id', client.id);

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBytes.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
        'X-Invoice-Id': invoice.id,
        'X-Document-Id': document.id,
        'X-Client-Id': client.id,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create invoice PDF.';
    const status =
      message.startsWith('Complete the required fields') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
