import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { extractClientiData } from '@/lib/client-manager/extractor';
import {
  type ClientCreditEventRow,
  type ClientDocumentRow,
  type ClientRow,
  type CreditEventType,
  type DocumentCategory,
} from '@/lib/client-manager/types';
import {
  clientiPathExists,
  resolveClientiRootPath,
} from '@/lib/client-manager/paths';
import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';

export const runtime = 'nodejs';

interface ClientLookupRow {
  id: string;
  name: string;
  folder_slug: string;
}

interface ClientDocumentLookupRow {
  id: string;
  client_id?: string;
  relative_path: string;
  content_sha256?: string | null;
  storage_origin?: 'folder' | 'upload';
}

interface ClientUpsertRow {
  name: string;
  folder_slug: string;
  first_seen_year: number | null;
  last_seen_year: number | null;
  total_documents: number;
  categories: DocumentCategory[];
}

interface DocumentUpsertRow {
  client_id: string;
  file_name: string;
  relative_path: string;
  absolute_path: string;
  year: number | null;
  extension: string;
  category: DocumentCategory;
  inferred_document_number: string | null;
  inferred_document_date: string | null;
  file_size_bytes: number;
  mime_type: string;
  content_sha256: string;
  content: Uint8Array | string;
  storage_origin: 'folder';
}

interface CreditEventUpsertRow {
  client_id: string;
  source_type: 'spreadsheet';
  source_document_id: string | null;
  source_relative_path: string;
  source_sheet: string;
  source_row: number;
  event_type: CreditEventType;
  event_date: string | null;
  analyses_count: number | null;
  equipment: string | null;
  unit_cost: number | null;
  amount: number | null;
  balance_before: number | null;
  balance_after: number | null;
  comment: string | null;
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function mimeTypeForExtension(extension: string) {
  return (
    {
      '.pdf': 'application/pdf',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.csv': 'text/csv',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    }[extension.toLowerCase()] ?? 'application/octet-stream'
  );
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

function getReadableError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Unknown error';
  }
  const maybeError = error as { message?: string };
  return maybeError.message ?? 'Unknown error';
}

export async function POST() {
  try {
    const clientiRootPath = await resolveClientiRootPath();
    const clientiExists = await clientiPathExists(clientiRootPath);

    if (!clientiExists) {
      return NextResponse.json(
        {
          error:
            'Clienti folder was not found. Set CLIENTI_FOLDER_PATH to the correct absolute path.',
          clientiRootPath,
        },
        { status: 400 }
      );
    }

    const extracted = await extractClientiData(clientiRootPath);
    const supabase = getSupabaseAdminClient();
    const usesRemoteSupabase = getApplicationDatabaseSource() === 'supabase';

    const clientRows: ClientUpsertRow[] = extracted.clients.map((client) => ({
      name: client.name,
      folder_slug: client.folderSlug,
      first_seen_year: client.firstSeenYear,
      last_seen_year: client.lastSeenYear,
      total_documents: client.totalDocuments,
      categories: client.categories,
    }));

    if (clientRows.length > 0) {
      const clientsTable = supabase.from('clients') as any;
      const { error: upsertClientsError } = await clientsTable.upsert(clientRows, {
        onConflict: 'folder_slug',
      });

      if (upsertClientsError) {
        return NextResponse.json(
          {
            error: `Unable to upsert clients: ${upsertClientsError.message}`,
          },
          { status: 500 }
        );
      }
    }

    const { data: clientsData, error: clientsLookupError } = await supabase
      .from('clients')
      .select('id, name, folder_slug')
      .in(
        'folder_slug',
        extracted.clients.map((client) => client.folderSlug)
      );

    if (clientsLookupError) {
      return NextResponse.json(
        {
          error: `Unable to fetch synced clients: ${clientsLookupError.message}`,
        },
        { status: 500 }
      );
    }

    const clientLookupByFolderSlug = new Map(
      ((clientsData ?? []) as ClientLookupRow[]).map((row) => [row.folder_slug, row.id])
    );

    const extractedDocumentPaths = extracted.documents.map(
      (document) => document.relativePath
    );
    const { data: existingDocumentData, error: existingDocumentReadError } =
      extractedDocumentPaths.length > 0
        ? await supabase
            .from('client_documents')
            .select('id, client_id, relative_path, content_sha256, storage_origin')
            .in('relative_path', extractedDocumentPaths)
        : { data: [], error: null };
    if (existingDocumentReadError) {
      return NextResponse.json(
        {
          error: `Unable to inspect existing client documents: ${existingDocumentReadError.message}`,
        },
        { status: 500 }
      );
    }
    const existingDocumentByPath = new Map(
      ((existingDocumentData ?? []) as ClientDocumentLookupRow[]).map((document) => [
        document.relative_path,
        document,
      ])
    );

    const documentRows: DocumentUpsertRow[] = [];
    for (const document of extracted.documents) {
      const clientId = clientLookupByFolderSlug.get(document.clientFolderSlug);
      if (!clientId) continue;
      const content = await readFile(document.absolutePath);
      const contentSha256 = createHash('sha256').update(content).digest('hex');
      const existingDocument = existingDocumentByPath.get(document.relativePath);
      if (
        existingDocument?.content_sha256 === contentSha256 &&
        existingDocument.client_id === clientId
      ) {
        continue;
      }
      documentRows.push({
          client_id: clientId,
          file_name: document.fileName,
          relative_path: document.relativePath,
          absolute_path: document.absolutePath,
          year: document.year,
          extension: document.extension,
          category: document.category,
          inferred_document_number: document.inferredDocumentNumber,
          inferred_document_date: document.inferredDocumentDate,
          file_size_bytes: document.fileSizeBytes,
          mime_type: mimeTypeForExtension(document.extension),
          content_sha256: contentSha256,
          content: usesRemoteSupabase
            ? `\\x${content.toString('hex')}`
            : new Uint8Array(content),
          storage_origin: 'folder',
      });
    }

    for (const documentChunk of chunkArray(documentRows, 20)) {
      const documentsTable = supabase.from('client_documents') as any;
      const { error: upsertDocumentsError } = await documentsTable.upsert(
        documentChunk,
        { onConflict: 'relative_path' }
      );

      if (upsertDocumentsError) {
        return NextResponse.json(
          {
            error: `Unable to upsert documents: ${upsertDocumentsError.message}`,
          },
          { status: 500 }
        );
      }
    }

    const extractedDocumentPathSet = new Set(
      extracted.documents.map((document) => document.relativePath)
    );
    const clientIds = Array.from(clientLookupByFolderSlug.values());
    if (clientIds.length > 0) {
      const { data: existingDocuments, error: existingDocumentsError } =
        await supabase
          .from('client_documents')
          .select('id, relative_path, storage_origin')
          .in('client_id', clientIds);
      if (existingDocumentsError) {
        return NextResponse.json(
          { error: `Unable to reconcile client documents: ${existingDocumentsError.message}` },
          { status: 500 }
        );
      }
      for (const existing of (existingDocuments ?? []) as ClientDocumentLookupRow[]) {
          if (
            existing.storage_origin !== 'upload' &&
            !existing.relative_path.startsWith('Results/') &&
            !extractedDocumentPathSet.has(existing.relative_path)
          ) {
          const { error: deleteError } = await supabase
            .from('client_documents')
            .delete()
            .eq('id', existing.id);
          if (deleteError) {
            return NextResponse.json(
              { error: `Unable to remove stale client document: ${deleteError.message}` },
              { status: 500 }
            );
          }
        }
      }
    }

    const creditEventSourcePaths = Array.from(
      new Set(extracted.creditEvents.map((event) => event.sourceRelativePath))
    );
    const documentIdByRelativePath = new Map<string, string>();

    if (creditEventSourcePaths.length > 0) {
      const { data: creditSourceDocs, error: creditSourceDocsError } = await supabase
        .from('client_documents')
        .select('id, relative_path')
        .in('relative_path', creditEventSourcePaths);

      if (creditSourceDocsError) {
        return NextResponse.json(
          {
            error: `Unable to resolve credit source documents: ${creditSourceDocsError.message}`,
          },
          { status: 500 }
        );
      }

      for (const row of (creditSourceDocs ?? []) as ClientDocumentLookupRow[]) {
        documentIdByRelativePath.set(row.relative_path, row.id);
      }
    }

    const creditEventRows = extracted.creditEvents
      .map((event) => {
        const clientId = clientLookupByFolderSlug.get(event.clientFolderSlug);
        if (!clientId) {
          return null;
        }

        return {
          client_id: clientId,
          source_type: 'spreadsheet',
          source_document_id:
            documentIdByRelativePath.get(event.sourceRelativePath) ?? null,
          source_relative_path: event.sourceRelativePath,
          source_sheet: event.sourceSheet || '',
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
        } satisfies CreditEventUpsertRow;
      })
      .filter((row): row is CreditEventUpsertRow => row !== null);

    if (clientIds.length > 0) {
      const { error: clearEventsError } = await supabase
        .from('client_credit_events')
        .delete()
        .eq('source_type', 'spreadsheet')
        .in('client_id', clientIds);
      if (clearEventsError) {
        return NextResponse.json(
          { error: `Unable to rebuild spreadsheet credit events: ${clearEventsError.message}` },
          { status: 500 }
        );
      }
    }

    for (const eventChunk of chunkArray(creditEventRows, 250)) {
      const creditEventsTable = supabase.from('client_credit_events') as any;
      const { error: upsertCreditEventsError } =
        await creditEventsTable.insert(eventChunk);

      if (upsertCreditEventsError) {
        if (hasMissingTableError(upsertCreditEventsError)) {
          return NextResponse.json(
            {
              error:
                'Supabase credit event tables are missing. Apply supabase/migrations/20260308_client_manager.sql first.',
            },
            { status: 400 }
          );
        }

        return NextResponse.json(
          {
            error: `Unable to upsert client credit events: ${upsertCreditEventsError.message}`,
          },
          { status: 500 }
        );
      }
    }

    const activeFolderSlugs = new Set(
      extracted.clients.map((client) => client.folderSlug)
    );
    const { data: allClientRows, error: allClientsError } = await supabase
      .from('clients')
      .select('id, folder_slug');
    if (allClientsError) {
      return NextResponse.json(
        { error: `Unable to reconcile client identities: ${allClientsError.message}` },
        { status: 500 }
      );
    }
    for (const staleClient of (allClientRows ?? []) as Array<{
      id: string;
      folder_slug: string;
    }>) {
      if (activeFolderSlugs.has(staleClient.folder_slug)) continue;
      const [{ count: linkedDocumentCount }, { count: manualEventCount }] =
        await Promise.all([
          supabase
            .from('client_documents')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', staleClient.id),
          supabase
            .from('client_credit_events')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', staleClient.id)
            .eq('source_type', 'manual'),
        ]);
      if ((linkedDocumentCount ?? 0) > 0 || (manualEventCount ?? 0) > 0) {
        continue;
      }
      const { error: deleteStaleClientError } = await supabase
        .from('clients')
        .delete()
        .eq('id', staleClient.id);
      if (deleteStaleClientError) {
        return NextResponse.json(
          {
            error: `Unable to remove stale client identity: ${deleteStaleClientError.message}`,
          },
          { status: 500 }
        );
      }
    }

    if (clientIds.length > 0) {
      const { data: countsData, error: countsError } = await supabase
        .from('client_documents')
        .select('client_id')
        .in('client_id', clientIds);

      if (countsError) {
        return NextResponse.json(
          {
            error: `Unable to calculate document counts: ${countsError.message}`,
          },
          { status: 500 }
        );
      }

      const totalsByClient = new Map<string, number>();
      for (const item of (countsData ?? []) as Pick<ClientDocumentRow, 'client_id'>[]) {
        const current = totalsByClient.get(item.client_id) ?? 0;
        totalsByClient.set(item.client_id, current + 1);
      }

      const clientCountUpdates = clientIds.map((clientId) => ({
        id: clientId,
        total_documents: totalsByClient.get(clientId) ?? 0,
      }));

      const clientsTable = supabase.from('clients') as any;
      for (const updateChunk of chunkArray(clientCountUpdates, 100)) {
        for (const updateRow of updateChunk) {
          const { error: countUpdateError } = await clientsTable
            .update({ total_documents: updateRow.total_documents })
            .eq('id', updateRow.id);

          if (countUpdateError) {
            return NextResponse.json(
              {
                error: `Unable to update client totals: ${countUpdateError.message}`,
              },
              { status: 500 }
            );
          }
        }
      }
    }

    const { data: syncedClients, error: syncedClientsError } = await supabase
      .from('clients')
      .select(
        'id, name, folder_slug, first_seen_year, last_seen_year, total_documents, categories, created_at, updated_at'
      )
      .order('name', { ascending: true });

    if (syncedClientsError) {
      return NextResponse.json(
        {
          error: `Unable to fetch clients after sync: ${syncedClientsError.message}`,
        },
        { status: 500 }
      );
    }

    const { count: syncedCreditEventsCount, error: syncedCreditEventsCountError } =
      await supabase
        .from('client_credit_events')
        .select('id', { head: true, count: 'exact' })
        .in('client_id', clientIds);

    if (syncedCreditEventsCountError && !hasMissingTableError(syncedCreditEventsCountError)) {
      return NextResponse.json(
        {
          error: `Unable to count synced credit events: ${syncedCreditEventsCountError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Client data synced to the application database.',
      sourceFolder: extracted.sourceFolder,
      clientiRootPath,
      extractedAt: extracted.extractedAt,
      extractedStats: extracted.stats,
      warnings: extracted.warnings,
      syncedClients: ((syncedClients ?? []) as ClientRow[]).length,
      syncedDocuments: extracted.documents.length,
      updatedDocuments: documentRows.length,
      unchangedDocuments: extracted.documents.length - documentRows.length,
      syncedCreditEvents: syncedCreditEventsCount ?? creditEventRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Unexpected sync error: ${getReadableError(error)}`,
      },
      { status: 500 }
    );
  }
}
