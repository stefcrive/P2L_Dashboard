import { createHash } from 'node:crypto';
import { cloudEnabled } from '@/lib/cloud/database';
import { syncHostedResults } from '@/lib/cloud/sync-results';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';

import {
  createResultClient,
  importResultFile,
  type ResultClient,
} from '@/lib/results/importer';
import {
  buildCanonicalResultClientMap,
  matchExistingResultClient,
  normalizeResultClientIdentity,
  parseResultFileName,
  parseResultWorkbook,
} from '@/lib/results/parser';
import { resolveResultsRootPath } from '@/lib/results/paths';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 300;

type ExistingDocument = {
  id: string;
  relative_path: string;
  content_sha256: string | null;
  storage_origin: 'folder' | 'upload';
};

export async function POST(request: Request) {
  try {
    if (cloudEnabled()) return NextResponse.json(await syncHostedResults(new URL(request.url).searchParams.get('force') === '1'));
    const resultsRootPath = await resolveResultsRootPath();
    const entries = await readdir(resultsRootPath, { withFileTypes: true });
    const fileNames = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.name.startsWith('._') &&
          /\.(xlsx|xls)$/i.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort((first, second) => first.localeCompare(second));
    const metadataByFile = new Map(
      fileNames.map((fileName) => [fileName, parseResultFileName(fileName)])
    );
    const canonicalNames = buildCanonicalResultClientMap(
      Array.from(metadataByFile.values()).map(
        (metadata) => metadata.clientCandidate
      )
    );
    const database = getSupabaseAdminClient();
    const [{ data: clientRows, error: clientsError }, { data: documentRows }] =
      await Promise.all([
        database.from('clients').select('id, name').order('name'),
        database
          .from('client_documents')
          .select('id, relative_path, content_sha256, storage_origin'),
      ]);
    if (clientsError) throw new Error(clientsError.message);

    const clients = [...((clientRows ?? []) as ResultClient[])];
    const existingDocuments = new Map(
      ((documentRows ?? []) as ExistingDocument[]).map((document) => [
        document.relative_path,
        document,
      ])
    );
    const { data: existingResultRows } = await database
      .from('client_result_files')
      .select('source_document_id');
    const registeredDocumentIds = new Set(
      (existingResultRows ?? []).map(
        (resultFile: { source_document_id: string }) =>
          resultFile.source_document_id
      )
    );
    const force = new URL(request.url).searchParams.get('force') === '1';

    let importedFiles = 0;
    let skippedFiles = 0;
    let importedRows = 0;
    const warnings: string[] = [];
    const errors: string[] = [];
    const activeRelativePaths = new Set<string>();

    for (const fileName of fileNames) {
      const absolutePath = path.join(resultsRootPath, fileName);
      const relativePath = `Results/${fileName}`;
      activeRelativePaths.add(relativePath);
      try {
        const metadata = metadataByFile.get(fileName)!;
        const bytes = new Uint8Array(await readFile(absolutePath));
        const digest = createHash('sha256').update(bytes).digest('hex');
        const existingDocument = existingDocuments.get(relativePath);
        if (
          !force &&
          existingDocument?.content_sha256 === digest &&
          registeredDocumentIds.has(existingDocument.id)
        ) {
          skippedFiles += 1;
          continue;
        }

        const canonicalCandidate =
          canonicalNames.get(
            normalizeResultClientIdentity(metadata.clientCandidate)
          ) ?? metadata.clientCandidate;
        let client = matchExistingResultClient(canonicalCandidate, clients);
        if (!client) {
          client = await createResultClient(canonicalCandidate);
          clients.push(client);
        }

        const parsed = parseResultWorkbook(bytes, fileName);
        const imported = await importResultFile({
          client,
          bytes,
          metadata: {
            ...metadata,
            clientCandidate: canonicalCandidate,
          },
          parsed,
          relativePath,
          absolutePath,
          storageOrigin: 'folder',
        });
        importedFiles += 1;
        importedRows += imported.rowCount;
        warnings.push(...imported.warnings);
      } catch (error) {
        errors.push(
          `${fileName}: ${
            error instanceof Error ? error.message : 'Unknown import error'
          }`
        );
      }
    }

    for (const document of Array.from(existingDocuments.values())) {
      if (
        document.storage_origin !== 'upload' &&
        document.relative_path.startsWith('Results/') &&
        !activeRelativePaths.has(document.relative_path)
      ) {
        const { error } = await database
          .from('client_documents')
          .delete()
          .eq('id', document.id);
        if (error) {
          warnings.push(
            `Could not remove stale result document ${document.relative_path}: ${error.message}`
          );
        }
      }
    }

    return NextResponse.json({
      message: errors.length
        ? 'Results folder processed with import errors.'
        : 'Results folder processed.',
      sourceFolder: resultsRootPath,
      totalFiles: fileNames.length,
      importedFiles,
      skippedFiles,
      importedRows,
      warnings,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to process the Results folder.',
      },
      { status: 500 }
    );
  }
}
