import { cloudEnabled } from '@/lib/cloud/database';
import { storeCloudDocument } from '@/lib/cloud/files';
import 'server-only';

import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  getApplicationDatabaseSource,
  getSupabaseAdminClient,
} from '@/lib/supabase/admin';
import {
  type ParsedResultWorkbook,
  type ResultFileMetadata,
  slugifyResultClient,
} from '@/lib/results/parser';

export type ResultClient = {
  id: string;
  name: string;
};

type ImportResultInput = {
  client: ResultClient;
  bytes: Uint8Array;
  metadata: ResultFileMetadata;
  parsed: ParsedResultWorkbook;
  relativePath: string;
  absolutePath: string;
  storageOrigin: 'folder' | 'upload';
};

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function createResultClient(name: string): Promise<ResultClient> {
  const database = getSupabaseAdminClient();
  const folderSlug = slugifyResultClient(name);
  const { data: existing } = await database
    .from('clients')
    .select('id, name')
    .eq('folder_slug', folderSlug)
    .maybeSingle();
  if (existing) return existing as ResultClient;

  const { data, error } = await database
    .from('clients')
    .insert({
      name,
      folder_slug: folderSlug,
      first_seen_year: null,
      last_seen_year: null,
      total_documents: 0,
      categories: ['analysis'],
    })
    .select('id, name')
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? `Unable to create client ${name}.`);
  }
  return data as ResultClient;
}

export async function importResultFile(input: ImportResultInput) {
  const database = getSupabaseAdminClient();
  const contentSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const extension = path.extname(input.metadata.fileName).toLowerCase() || '.xlsx';
  const cloudReference = cloudEnabled() ? await storeCloudDocument(input.bytes) : null;
  const content = cloudReference ? null :
    getApplicationDatabaseSource() === 'supabase'
      ? `\\x${Buffer.from(input.bytes).toString('hex')}`
      : input.bytes;

  const { data: document, error: documentError } = await database
    .from('client_documents')
    .upsert(
      {
        client_id: input.client.id,
        file_name: input.metadata.fileName,
        relative_path: input.relativePath,
        absolute_path: cloudReference ?? input.absolutePath,
        year: input.metadata.resultYear,
        extension,
        category: 'analysis',
        inferred_document_number: null,
        inferred_document_date: input.metadata.resultDate,
        file_size_bytes: input.bytes.byteLength,
        mime_type:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content_sha256: contentSha256,
        content,
        storage_origin: input.storageOrigin,
      },
      { onConflict: 'relative_path' }
    )
    .select(
      'id, client_id, file_name, relative_path, content_sha256, storage_origin'
    )
    .single();
  if (documentError || !document) {
    throw new Error(
      documentError?.message ?? `Unable to store ${input.metadata.fileName}.`
    );
  }

  const { data: resultFile, error: resultFileError } = await database
    .from('client_result_files')
    .upsert(
      {
        client_id: input.client.id,
        source_document_id: document.id,
        analysis_series: input.metadata.analysisSeries,
        result_date: input.metadata.resultDate,
        row_count: input.parsed.measurements.length,
        identifier_1_count: input.parsed.identifier1Count,
        species_count: input.parsed.speciesCount,
        status: input.parsed.warnings.length ? 'warning' : 'parsed',
        import_error: input.parsed.warnings.join(' ') || null,
      },
      { onConflict: 'source_document_id' }
    )
    .select(
      'id, client_id, source_document_id, analysis_series, result_date, row_count, identifier_1_count, species_count, status, import_error'
    )
    .single();
  if (resultFileError || !resultFile) {
    throw new Error(
      resultFileError?.message ??
        `Unable to register ${input.metadata.fileName}.`
    );
  }

  const { error: clearError } = await database
    .from('result_measurements')
    .delete()
    .eq('result_file_id', resultFile.id);
  if (clearError) {
    throw new Error(
      `Unable to refresh measurements for ${input.metadata.fileName}: ${clearError.message}`
    );
  }

  const rows = input.parsed.measurements.map((measurement) => ({
    result_file_id: resultFile.id,
    client_id: input.client.id,
    identifier_1: measurement.identifier1,
    identifier_2: measurement.identifier2,
    identifier_2_order: measurement.identifier2Order,
    species: measurement.species,
    d13c_value: measurement.d13cValue,
    d13c_uncertainty: measurement.d13cUncertainty,
    d18o_value: measurement.d18oValue,
    d18o_uncertainty: measurement.d18oUncertainty,
    corrected_d13c: measurement.correctedD13c,
    corrected_d18o: measurement.correctedD18o,
    method: measurement.method,
    observation: measurement.observation,
    source_sheet: measurement.sourceSheet,
    source_row: measurement.sourceRow,
  }));
  for (const chunk of chunkArray(rows, 300)) {
    if (!chunk.length) continue;
    const { error } = await database.from('result_measurements').insert(chunk);
    if (error) {
      throw new Error(
        `Unable to import measurements from ${input.metadata.fileName}: ${error.message}`
      );
    }
  }

  const { data: currentClient } = await database
    .from('clients')
    .select(
      'id, first_seen_year, last_seen_year, categories'
    )
    .eq('id', input.client.id)
    .single();
  const { count: documentCount } = await database
    .from('client_documents')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', input.client.id);
  const categories = Array.from(
    new Set([...(currentClient?.categories ?? []), 'analysis'])
  );
  const years = [
    currentClient?.first_seen_year,
    currentClient?.last_seen_year,
    input.metadata.resultYear,
  ].filter((value): value is number => typeof value === 'number');
  const { error: clientUpdateError } = await database
    .from('clients')
    .update({
      total_documents: documentCount ?? 0,
      categories,
      first_seen_year: years.length ? Math.min(...years) : null,
      last_seen_year: years.length ? Math.max(...years) : null,
    })
    .eq('id', input.client.id);
  if (clientUpdateError) {
    throw new Error(
      `Imported ${input.metadata.fileName}, but could not update its client: ${clientUpdateError.message}`
    );
  }

  return {
    documentId: document.id as string,
    resultFileId: resultFile.id as string,
    rowCount: input.parsed.measurements.length,
    warnings: input.parsed.warnings,
    contentSha256,
  };
}

