import 'server-only';
import { getCloudDatabase } from './database';
import { readCloudDocument } from './files';
import { importResultFile } from '@/lib/results/importer';
import { parseResultFileName, parseResultWorkbook } from '@/lib/results/parser';

export async function syncHostedResults(force: boolean) {
  const database = getCloudDatabase();
  const { rows } = await database.query<{ id: string; client_id: string; client_name: string; file_name: string; absolute_path: string; relative_path: string; storage_origin: 'upload' | 'folder'; content: Uint8Array | null; imported: boolean }>(`SELECT d.id,d.client_id,c.name AS client_name,d.file_name,d.absolute_path,d.relative_path,d.storage_origin,d.content,EXISTS(SELECT 1 FROM client_result_files f WHERE f.source_document_id=d.id) AS imported FROM client_documents d JOIN clients c ON c.id=d.client_id WHERE d.category='analysis' AND d.extension IN ('.xlsx','.xls')`);
  let importedFiles = 0, skippedFiles = 0, importedRows = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (row.imported && !force) { skippedFiles++; continue; }
    try {
      const bytes = row.content ?? await readCloudDocument(row.absolute_path);
      if (!bytes) throw new Error('Source document unavailable.');
      const imported = await importResultFile({ client: { id: row.client_id, name: row.client_name }, bytes, metadata: parseResultFileName(row.file_name), parsed: parseResultWorkbook(bytes, row.file_name), relativePath: row.relative_path, absolutePath: row.absolute_path, storageOrigin: row.storage_origin });
      importedFiles++; importedRows += imported.rowCount;
    } catch (error) { errors.push(`${row.file_name}: ${error instanceof Error ? error.message : 'Import failed'}`); }
  }
  return { totalFiles: rows.length, importedFiles, skippedFiles, importedRows, errors, warnings: [] };
}
