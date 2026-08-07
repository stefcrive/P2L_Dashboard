import { NextResponse } from 'next/server';

import { extractClientiData } from '@/lib/client-manager/extractor';
import {
  clientiPathExists,
  resolveClientiRootPath,
} from '@/lib/client-manager/paths';
import {
  DOCUMENT_CATEGORIES,
  type ClientCreditEventRow,
  type ClientDocumentRow,
  type ClientManagerDataResponse,
  type ClientRow,
  type ClientWithDocuments,
  type DocumentCategory,
} from '@/lib/client-manager/types';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';
const CLIENT_SELECT =
  'id, name, folder_slug, billing_details, email, phone, tax_id, first_seen_year, last_seen_year, total_documents, categories, created_at, updated_at';
const DOCUMENT_SELECT =
  'id, client_id, file_name, relative_path, absolute_path, year, extension, category, inferred_document_number, inferred_document_date, file_size_bytes, mime_type, content_sha256, storage_origin, created_at, updated_at';
const CREDIT_EVENT_SELECT =
  'id, client_id, source_type, source_document_id, source_relative_path, source_sheet, source_row, event_type, event_date, analyses_count, equipment, unit_cost, amount, balance_before, balance_after, comment, created_at, updated_at';

interface QueryFilters {
  search: string;
  year: number | null;
  category: DocumentCategory | null;
}

interface SupabaseQueryError {
  message: string;
  code?: string;
}

function buildZeroCategoryRecord(): Record<DocumentCategory, number> {
  return DOCUMENT_CATEGORIES.reduce((accumulator, category) => {
    accumulator[category] = 0;
    return accumulator;
  }, {} as Record<DocumentCategory, number>);
}

function sortDocuments(
  firstDocument: ClientDocumentRow,
  secondDocument: ClientDocumentRow
): number {
  const yearA = firstDocument.year ?? 0;
  const yearB = secondDocument.year ?? 0;
  if (yearA !== yearB) {
    return yearB - yearA;
  }
  return firstDocument.file_name.localeCompare(secondDocument.file_name);
}

function sortCreditEvents(
  firstEvent: ClientCreditEventRow,
  secondEvent: ClientCreditEventRow
): number {
  const dateA = String(firstEvent.event_date ?? '');
  const dateB = String(secondEvent.event_date ?? '');
  if (dateA !== dateB) {
    return dateB.localeCompare(dateA);
  }
  return String(secondEvent.created_at ?? '').localeCompare(
    String(firstEvent.created_at ?? '')
  );
}

function parseFilters(request: Request): QueryFilters {
  const searchParams = new URL(request.url).searchParams;
  const rawSearch = (searchParams.get('q') ?? '').trim();
  const rawYear = (searchParams.get('year') ?? '').trim();
  const rawCategory = (searchParams.get('category') ?? '').trim();
  const parsedYear = Number.parseInt(rawYear, 10);
  const parsedCategory = DOCUMENT_CATEGORIES.includes(
    rawCategory as DocumentCategory
  )
    ? (rawCategory as DocumentCategory)
    : null;

  return {
    search: rawSearch.toLowerCase(),
    year: Number.isNaN(parsedYear) ? null : parsedYear,
    category: parsedCategory,
  };
}

function resolveCurrentBalance(events: ClientCreditEventRow[]): number | null {
  let pendingManualChange = 0;
  let hasManualEvent = false;

  for (const event of events) {
    if (event.source_type === 'manual') {
      if (event.balance_after !== null) {
        return event.balance_after + pendingManualChange;
      }
      pendingManualChange += event.amount ?? 0;
      hasManualEvent = true;
      continue;
    }
    if (event.balance_after !== null) {
      return event.balance_after + pendingManualChange;
    }
    if (event.balance_before !== null) {
      return event.balance_before + pendingManualChange;
    }
  }

  return hasManualEvent ? pendingManualChange : null;
}

function applyFilters(
  clients: ClientRow[],
  documents: ClientDocumentRow[],
  creditEvents: ClientCreditEventRow[],
  filters: QueryFilters
): {
  clients: ClientWithDocuments[];
  documents: ClientDocumentRow[];
  creditEvents: ClientCreditEventRow[];
} {
  const matchedClientIdsByName = new Set(
    clients
      .filter((client) => client.name.toLowerCase().includes(filters.search))
      .map((client) => client.id)
  );

  const filteredDocuments = documents
    .filter((document) => {
      if (filters.year !== null && document.year !== filters.year) {
        return false;
      }
      if (filters.category !== null && document.category !== filters.category) {
        return false;
      }
      if (!filters.search) {
        return true;
      }

      const fileMatch =
        document.file_name.toLowerCase().includes(filters.search) ||
        document.relative_path.toLowerCase().includes(filters.search);
      const clientNameMatch = matchedClientIdsByName.has(document.client_id);
      return fileMatch || clientNameMatch;
    })
    .sort(sortDocuments);

  const hasActiveFilters =
    Boolean(filters.search) || filters.year !== null || filters.category !== null;

  const filteredDocumentClientIds = new Set(
    filteredDocuments.map((document) => document.client_id)
  );
  const filteredClients = clients
    .filter((client) => {
      if (!hasActiveFilters) {
        return true;
      }
      if (matchedClientIdsByName.has(client.id)) {
        return true;
      }
      return filteredDocumentClientIds.has(client.id);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const filteredClientIds = new Set(filteredClients.map((client) => client.id));
  const filteredCreditEvents = creditEvents
    .filter((event) => filteredClientIds.has(event.client_id))
    .sort(sortCreditEvents);

  const documentsByClient = new Map<string, ClientDocumentRow[]>();
  for (const document of filteredDocuments) {
    const bucket = documentsByClient.get(document.client_id) ?? [];
    bucket.push(document);
    documentsByClient.set(document.client_id, bucket);
  }

  const creditEventsByClient = new Map<string, ClientCreditEventRow[]>();
  for (const event of filteredCreditEvents) {
    const bucket = creditEventsByClient.get(event.client_id) ?? [];
    bucket.push(event);
    creditEventsByClient.set(event.client_id, bucket);
  }

  const clientsWithDocuments = filteredClients.map((client) => {
    const clientDocuments = documentsByClient.get(client.id) ?? [];
    const clientCreditEvents = creditEventsByClient.get(client.id) ?? [];

    return {
      ...client,
      total_documents:
        clientDocuments.length > 0 || !hasActiveFilters
          ? clientDocuments.length || client.total_documents
          : 0,
      documents: clientDocuments,
      credit_events: clientCreditEvents,
      current_credit_balance: resolveCurrentBalance(clientCreditEvents),
    };
  });

  for (const client of clientsWithDocuments) {
    client.documents.sort(sortDocuments);
    client.credit_events.sort(sortCreditEvents);
  }

  return {
    clients: clientsWithDocuments,
    documents: filteredDocuments,
    creditEvents: filteredCreditEvents,
  };
}

function buildResponse(
  source: 'local' | 'supabase' | 'filesystem',
  warnings: string[],
  clients: ClientRow[],
  documents: ClientDocumentRow[],
  creditEvents: ClientCreditEventRow[],
  filters: QueryFilters
): ClientManagerDataResponse {
  const {
    clients: filteredClients,
    documents: filteredDocuments,
    creditEvents: filteredCreditEvents,
  } = applyFilters(clients, documents, creditEvents, filters);

  const availableYears = Array.from(
    new Set(
      documents
        .map((document) => document.year)
        .filter((year): year is number => year !== null)
    )
  ).sort((a, b) => b - a);

  const availableCategories = Array.from(
    new Set(documents.map((document) => document.category))
  ).sort() as DocumentCategory[];

  const documentsByCategory = buildZeroCategoryRecord();
  const documentsByYear: Record<string, number> = {};
  let totalStorageBytes = 0;

  for (const document of filteredDocuments) {
    documentsByCategory[document.category] += 1;
    totalStorageBytes += document.file_size_bytes ?? 0;
    const yearLabel = String(document.year ?? 'unknown');
    documentsByYear[yearLabel] = (documentsByYear[yearLabel] ?? 0) + 1;
  }

  const clientsWithCredit = filteredClients.filter(
    (client) => client.credit_events.length > 0
  ).length;
  const totalOutstandingCredit = filteredClients.reduce((total, client) => {
    if (client.current_credit_balance === null) {
      return total;
    }
    return total + Math.max(0, client.current_credit_balance);
  }, 0);
  const totalSpentAmount = filteredCreditEvents.reduce((total, event) => {
    if (event.amount === null || event.amount <= 0) {
      return total;
    }
    return total + event.amount;
  }, 0);

  return {
    source,
    warnings,
    availableYears,
    availableCategories,
    clients: filteredClients,
    documents: filteredDocuments,
    creditEvents: filteredCreditEvents,
    stats: {
      totalClients: filteredClients.length,
      totalDocuments: filteredDocuments.length,
      totalStorageBytes,
      totalCreditEvents: filteredCreditEvents.length,
      clientsWithCredit,
      totalOutstandingCredit,
      totalSpentAmount,
      documentsByCategory,
      documentsByYear,
    },
  };
}

function hasMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const normalized = error as { code?: string; message?: string };
  if (normalized.code === '42P01') {
    return true;
  }

  const message = normalized.message?.toLowerCase() ?? '';
  return message.includes('does not exist');
}

async function fetchClientsAndDocuments(
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<{
  clientsData: ClientRow[];
  documentsData: ClientDocumentRow[];
  clientsError: SupabaseQueryError | null;
  documentsError: SupabaseQueryError | null;
}> {
  const { data: clientsData, error: clientsError } = await supabase
    .from('clients')
    .select(CLIENT_SELECT)
    .order('name', { ascending: true });

  const { data: documentsData, error: documentsError } = await supabase
    .from('client_documents')
    .select(DOCUMENT_SELECT)
    .order('year', { ascending: false, nullsFirst: false })
    .order('file_name', { ascending: true });

  return {
    clientsData: (clientsData ?? []) as ClientRow[],
    documentsData: (documentsData ?? []) as ClientDocumentRow[],
    clientsError: clientsError
      ? { message: clientsError.message, code: (clientsError as { code?: string }).code }
      : null,
    documentsError: documentsError
      ? {
          message: documentsError.message,
          code: (documentsError as { code?: string }).code,
        }
      : null,
  };
}

async function fetchCreditEvents(
  supabase: ReturnType<typeof getSupabaseAdminClient>
): Promise<{
  data: ClientCreditEventRow[];
  error: SupabaseQueryError | null;
}> {
  const { data, error } = await supabase
    .from('client_credit_events')
    .select(CREDIT_EVENT_SELECT)
    .order('event_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  return {
    data: (data ?? []) as ClientCreditEventRow[],
    error: error
      ? { message: error.message, code: (error as { code?: string }).code }
      : null,
  };
}

async function triggerAutomaticSync(
  request: Request,
  syncPath: string
): Promise<string | null> {
  try {
    const syncUrl = new URL(syncPath, request.url);
    const response = await fetch(syncUrl.toString(), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'x-p2l-auto-sync': '1',
      },
    });

    if (response.ok) {
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    return payload?.error ?? `Request failed with status ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}

async function getFilesystemFallback(
  filters: QueryFilters,
  warnings: string[]
): Promise<ClientManagerDataResponse> {
  const clientiRootPath = await resolveClientiRootPath();
  const exists = await clientiPathExists(clientiRootPath);
  if (!exists) {
    return buildResponse('filesystem', warnings, [], [], [], filters);
  }

  const extracted = await extractClientiData(clientiRootPath);
  const clients: ClientRow[] = extracted.clients.map((client) => ({
    id: `fs-${client.folderSlug}`,
    name: client.name,
    folder_slug: client.folderSlug,
    billing_details: null,
    email: null,
    phone: null,
    tax_id: null,
    first_seen_year: client.firstSeenYear,
    last_seen_year: client.lastSeenYear,
    total_documents: client.totalDocuments,
    categories: client.categories,
    created_at: extracted.extractedAt,
    updated_at: extracted.extractedAt,
  }));

  const clientIdBySlug = new Map(clients.map((client) => [client.folder_slug, client.id]));
  const documents: ClientDocumentRow[] = extracted.documents.map((document, index) => ({
    id: `fs-doc-${index + 1}`,
    client_id: clientIdBySlug.get(document.clientFolderSlug) ?? 'fs-unknown',
    file_name: document.fileName,
    relative_path: document.relativePath,
    absolute_path: document.absolutePath,
    year: document.year,
    extension: document.extension,
    category: document.category,
    inferred_document_number: document.inferredDocumentNumber,
    inferred_document_date: document.inferredDocumentDate,
    file_size_bytes: document.fileSizeBytes,
    mime_type: null,
    content_sha256: null,
    storage_origin: 'folder',
    created_at: extracted.extractedAt,
    updated_at: extracted.extractedAt,
  }));

  const creditEvents: ClientCreditEventRow[] = extracted.creditEvents.map((event, index) => ({
    id: `fs-credit-${index + 1}`,
    client_id: clientIdBySlug.get(event.clientFolderSlug) ?? 'fs-unknown',
    source_type: 'spreadsheet',
    source_document_id: null,
    source_relative_path: event.sourceRelativePath,
    source_sheet: event.sourceSheet,
    source_row: event.sourceRow,
    event_type: event.eventType,
    event_date: event.eventDate,
    analyses_count: event.analysesCount,
    equipment: event.equipment,
    unit_cost: event.unitCost,
    amount: event.amount,
    balance_before: event.balanceBefore,
    balance_after: event.balanceAfter,
    comment: event.comment,
    created_at: extracted.extractedAt,
    updated_at: extracted.extractedAt,
  }));

  return buildResponse(
    'filesystem',
    [...warnings, ...extracted.warnings],
    clients,
    documents,
    creditEvents,
    filters
  );
}

export async function GET(request: Request) {
  const filters = parseFilters(request);

  try {
    const supabase = getSupabaseAdminClient();
    const warnings: string[] = [];

    let {
      clientsData,
      documentsData,
      clientsError,
      documentsError,
    } = await fetchClientsAndDocuments(supabase);

    if (clientsError || documentsError) {
      const collectedWarnings = [
        clientsError?.message,
        documentsError?.message,
      ].filter((message): message is string => Boolean(message));

      const shouldFallback =
        hasMissingTableError(clientsError) || hasMissingTableError(documentsError);
      if (shouldFallback) {
        return NextResponse.json(
          await getFilesystemFallback(filters, [
            ...collectedWarnings,
            'Supabase tables are missing. Apply supabase/migrations/20260308_client_manager.sql. Automatic sync runs on startup after migration.',
          ])
        );
      }

      return NextResponse.json(
        { error: collectedWarnings.join(' | ') || 'Unable to load client manager data.' },
        { status: 500 }
      );
    }

    if (clientsData.length === 0 && documentsData.length === 0) {
      const syncWarning = await triggerAutomaticSync(
        request,
        '/api/client-manager/sync'
      );
      if (syncWarning) {
        warnings.push(`Automatic startup sync failed: ${syncWarning}`);
      } else {
        const refreshed = await fetchClientsAndDocuments(supabase);
        clientsData = refreshed.clientsData;
        documentsData = refreshed.documentsData;
        clientsError = refreshed.clientsError;
        documentsError = refreshed.documentsError;

        if (clientsError || documentsError) {
          const collectedWarnings = [
            clientsError?.message,
            documentsError?.message,
          ].filter((message): message is string => Boolean(message));

          return NextResponse.json(
            {
              error:
                collectedWarnings.join(' | ') ||
                'Unable to load client manager data after automatic sync.',
            },
            { status: 500 }
          );
        }
      }
    }

    const { data: creditEventsData, error: creditEventsError } =
      await fetchCreditEvents(supabase);

    if (creditEventsError) {
      if (!hasMissingTableError(creditEventsError)) {
        return NextResponse.json(
          { error: `Unable to load client credit events: ${creditEventsError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json(
        buildResponse(
          getApplicationDatabaseSource(),
          [
            ...warnings,
            'Credit event tables are missing. Apply supabase/migrations/20260308_client_manager.sql. Automatic sync runs on startup after migration.',
          ],
          clientsData,
          documentsData,
          [],
          filters
        )
      );
    }

    return NextResponse.json(
      buildResponse(
        getApplicationDatabaseSource(),
        warnings,
        clientsData,
        documentsData,
        creditEventsData,
        filters
      )
    );
  } catch (error) {
    return NextResponse.json(
      await getFilesystemFallback(filters, [
        `Unable to load application database data: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      ])
    );
  }
}
