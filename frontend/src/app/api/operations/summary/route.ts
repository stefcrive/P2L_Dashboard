import { NextResponse } from 'next/server';

import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface ResultSummaryRow {
  id: string;
  status: string;
}

interface InvoiceSummaryRow {
  id: string;
  status: string;
  total_amount: number | string | null;
  currency: string;
  due_date?: string | null;
  invoice_number: string;
  created_at: string;
}

interface MaterialSummaryRow {
  id: string;
  material_type: string;
  current_stock: number | string | null;
  minimum_stock: number | string | null;
}

interface LabActivityRow {
  id: string;
  title: string;
  entry_type: string;
  occurred_at: string;
  status: string;
}

interface ResultActivityRow {
  id: string;
  result_code: string;
  sample_reference: string;
  status: string;
  created_at: string;
}

function unavailableSummary() {
  return {
    source: 'unavailable' as const,
    error:
      'The embedded local database is unavailable. Restart the application and check `.local-data/app-postgres`.',
    pendingResults: 0,
    maintenanceDue: 0,
    lastBackupAt: null,
    metrics: {
      clients: 0,
      documents: 0,
      results: 0,
      openInvoices: 0,
      outstandingAmount: 0,
      lowStock: 0,
      activeProviders: 0,
      assets: 0,
    },
    recentActivity: [],
  };
}

export async function GET() {
  try {
    const supabase = getSupabaseAdminClient() as any;
    const today = new Date().toISOString();

    const [
      clientsResult,
      documentsResult,
      resultsResult,
      invoicesResult,
      materialsResult,
      providersResult,
      assetsResult,
      maintenanceResult,
      backupsResult,
      recentLabBookResult,
      recentResultsResult,
      recentInvoicesResult,
    ] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }),
      supabase
        .from('client_documents')
        .select('id', { count: 'exact', head: true }),
      supabase.from('client_results').select('id, status', { count: 'exact' }),
      supabase
        .from('client_invoices')
        .select('id, status, total_amount, currency, due_date'),
      supabase
        .from('materials_inventory')
        .select('id, material_type, current_stock, minimum_stock'),
      supabase
        .from('providers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('equipment_assets')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('lab_book_entries')
        .select('id, status, next_due_at')
        .not('next_due_at', 'is', null)
        .lte('next_due_at', today)
        .neq('status', 'cancelled'),
      supabase
        .from('backup_records')
        .select('started_at')
        .in('status', ['completed', 'verified'])
        .order('started_at', { ascending: false })
        .limit(1),
      supabase
        .from('lab_book_entries')
        .select('id, title, entry_type, occurred_at, status')
        .order('occurred_at', { ascending: false })
        .limit(4),
      supabase
        .from('client_results')
        .select('id, result_code, sample_reference, status, created_at')
        .order('created_at', { ascending: false })
        .limit(4),
      supabase
        .from('client_invoices')
        .select(
          'id, invoice_number, status, total_amount, currency, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(4),
    ]);

    const allResults = [
      clientsResult,
      documentsResult,
      resultsResult,
      invoicesResult,
      materialsResult,
      providersResult,
      assetsResult,
      maintenanceResult,
      backupsResult,
      recentLabBookResult,
      recentResultsResult,
      recentInvoicesResult,
    ];
    if (allResults.some((result) => result.error)) {
      throw new Error('One or more operational tables are unavailable.');
    }

    const resultRows = (resultsResult.data ?? []) as ResultSummaryRow[];
    const invoiceRows = (invoicesResult.data ?? []) as InvoiceSummaryRow[];
    const materialRows = (materialsResult.data ?? []) as MaterialSummaryRow[];
    const openInvoices = invoiceRows.filter((invoice) =>
      ['sent', 'overdue'].includes(invoice.status)
    );
    const lowStock = materialRows.filter(
      (material) =>
        material.material_type === 'consumable' &&
        material.current_stock !== null &&
        material.minimum_stock !== null &&
        Number(material.current_stock) <= Number(material.minimum_stock)
    ).length;

    const recentActivity = [
      ...((recentLabBookResult.data ?? []) as LabActivityRow[]).map(
        (entry) => ({
          id: `lab-${entry.id}`,
          kind: 'lab_book',
          title: entry.title,
          detail: entry.entry_type,
          status: entry.status,
          occurredAt: entry.occurred_at,
        })
      ),
      ...((recentResultsResult.data ?? []) as ResultActivityRow[]).map(
        (result) => ({
          id: `result-${result.id}`,
          kind: 'result',
          title: result.result_code,
          detail: result.sample_reference,
          status: result.status,
          occurredAt: result.created_at,
        })
      ),
      ...((recentInvoicesResult.data ?? []) as InvoiceSummaryRow[]).map(
        (invoice) => ({
          id: `invoice-${invoice.id}`,
          kind: 'invoice',
          title: invoice.invoice_number,
          detail: `${invoice.currency} ${Number(invoice.total_amount).toFixed(2)}`,
          status: invoice.status,
          occurredAt: invoice.created_at,
        })
      ),
    ]
      .sort(
        (left, right) =>
          new Date(right.occurredAt).getTime() -
          new Date(left.occurredAt).getTime()
      )
      .slice(0, 8);

    return NextResponse.json({
      source: getApplicationDatabaseSource(),
      pendingResults: resultRows.filter((result) => result.status === 'draft')
        .length,
      maintenanceDue: maintenanceResult.data?.length ?? 0,
      lastBackupAt: backupsResult.data?.[0]?.started_at ?? null,
      metrics: {
        clients: clientsResult.count ?? 0,
        documents: documentsResult.count ?? 0,
        results: resultsResult.count ?? resultRows.length,
        openInvoices: openInvoices.length,
        outstandingAmount: openInvoices.reduce(
          (sum, invoice) => sum + Number(invoice.total_amount ?? 0),
          0
        ),
        lowStock,
        activeProviders: providersResult.count ?? 0,
        assets: assetsResult.count ?? 0,
      },
      recentActivity,
    });
  } catch {
    return NextResponse.json(unavailableSummary());
  }
}
