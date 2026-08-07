import 'server-only';

import * as nodeFs from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  CREDIT_EVENT_TYPES,
  DOCUMENT_CATEGORIES,
  type CreditEventType,
  type DocumentCategory,
  type ExtractedClient,
  type ExtractedClientCreditEvent,
  type ExtractedDocument,
  type ExtractionSnapshot,
  type ExtractionStats,
} from '@/lib/client-manager/types';

const xlsxWithFs = XLSX as typeof XLSX & {
  set_fs?: (fs: typeof nodeFs) => void;
};
xlsxWithFs.set_fs?.(nodeFs);

const CREDIT_SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

type CreditCanonicalColumn =
  | 'balance'
  | 'analyses'
  | 'cost'
  | 'date'
  | 'equipment'
  | 'comment';

interface CreditColumnMap {
  balance?: number;
  analyses?: number;
  cost?: number;
  date?: number;
  equipment?: number;
  comment?: number;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cleanDisplayName(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  const slug = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown-client';
}

function parseYear(value: string | undefined): number | null {
  if (!value || !/^\d{4}$/.test(value)) {
    return null;
  }
  const year = Number.parseInt(value, 10);
  return year >= 2000 && year <= 2100 ? year : null;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate.toISOString().slice(0, 10);
}

function inferDateFromFileName(fileName: string): string | null {
  const yearFirst = fileName.match(/(20\d{2})[^\d]?([01]\d)[^\d]?([0-3]\d)/);
  if (yearFirst) {
    const [, yearRaw, monthRaw, dayRaw] = yearFirst;
    return buildIsoDate(
      Number.parseInt(yearRaw, 10),
      Number.parseInt(monthRaw, 10),
      Number.parseInt(dayRaw, 10)
    );
  }

  const dayFirst = fileName.match(/([0-3]\d)[^\d]?([01]\d)[^\d]?(20\d{2})/);
  if (dayFirst) {
    const [, dayRaw, monthRaw, yearRaw] = dayFirst;
    return buildIsoDate(
      Number.parseInt(yearRaw, 10),
      Number.parseInt(monthRaw, 10),
      Number.parseInt(dayRaw, 10)
    );
  }

  return null;
}

function inferDocumentNumber(fileName: string): string | null {
  const normalized = normalizeText(fileName);

  const invoiceMatch = normalized.match(
    /(?:nota fiscal|nf|invoice|iv)\s*[-_ ]*?(\d{3,})/
  );
  if (invoiceMatch) {
    return invoiceMatch[1] ?? null;
  }

  const genericMatch = normalized.match(/\b(\d{4,})\b/);
  return genericMatch?.[1] ?? null;
}

function inferCategory(fileName: string): DocumentCategory {
  const normalized = normalizeText(fileName);

  if (/(orcamento|quotation|proposta)/.test(normalized)) return 'quote';
  if (/(boleto|bl[_ -]?nf|^bol[_ -]?)/.test(normalized))
    return 'payment_slip';
  if (/(comprovante|pagamento)/.test(normalized)) return 'payment_receipt';
  if (/credito/.test(normalized)) return 'credit';
  if (/(autorizacao de fornecimento|af[_ -]?)/.test(normalized))
    return 'purchase_order';
  if (/(etiqueta|fedex)/.test(normalized)) return 'shipping';
  if (/(analise|analysis|amostr)/.test(normalized)) return 'analysis';
  if (/(nota fiscal|nf|invoice|^iv[_ -]?)/.test(normalized)) return 'invoice';

  return 'other';
}

async function walkFiles(directoryPath: string): Promise<string[]> {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of directoryEntries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function buildEmptyCategoryRecord(): Record<DocumentCategory, number> {
  return DOCUMENT_CATEGORIES.reduce((accumulator, category) => {
    accumulator[category] = 0;
    return accumulator;
  }, {} as Record<DocumentCategory, number>);
}

interface ClientAccumulator {
  name: string;
  folderSlug: string;
  firstSeenYear: number | null;
  lastSeenYear: number | null;
  totalDocuments: number;
  categories: Set<DocumentCategory>;
}

function sortDocuments(a: ExtractedDocument, b: ExtractedDocument): number {
  const yearA = a.year ?? 0;
  const yearB = b.year ?? 0;
  if (yearA !== yearB) {
    return yearB - yearA;
  }
  return a.relativePath.localeCompare(b.relativePath);
}

function sortCreditEvents(
  firstEvent: ExtractedClientCreditEvent,
  secondEvent: ExtractedClientCreditEvent
): number {
  const dateA = firstEvent.eventDate ?? '';
  const dateB = secondEvent.eventDate ?? '';
  if (dateA !== dateB) {
    return dateA.localeCompare(dateB);
  }

  if (firstEvent.sourceRelativePath !== secondEvent.sourceRelativePath) {
    return firstEvent.sourceRelativePath.localeCompare(secondEvent.sourceRelativePath);
  }

  return firstEvent.sourceRow - secondEvent.sourceRow;
}

function buildCanonicalClientSlugMap(
  clients: Map<string, ClientAccumulator>
): Map<string, string> {
  const slugs = Array.from(clients.keys());
  const parent = new Map(slugs.map((slug) => [slug, slug]));
  const tokens = (slug: string) =>
    slug.split('-').filter((token) => token.length > 1);
  const find = (slug: string): string => {
    const current = parent.get(slug) ?? slug;
    if (current === slug) return slug;
    const root = find(current);
    parent.set(slug, root);
    return root;
  };
  const union = (first: string, second: string) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };

  for (let firstIndex = 0; firstIndex < slugs.length; firstIndex += 1) {
    const firstSlug = slugs[firstIndex];
    const firstTokens = tokens(firstSlug);
    if (firstTokens.length < 2) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < slugs.length; secondIndex += 1) {
      const secondSlug = slugs[secondIndex];
      const secondTokens = tokens(secondSlug);
      if (secondTokens.length < 2) continue;
      const shorter =
        firstTokens.length <= secondTokens.length ? firstTokens : secondTokens;
      const longer =
        firstTokens.length <= secondTokens.length ? secondTokens : firstTokens;
      if (shorter.every((token) => longer.includes(token))) {
        union(firstSlug, secondSlug);
      }
    }
  }

  const clusters = new Map<string, string[]>();
  for (const slug of slugs) {
    const root = find(slug);
    clusters.set(root, [...(clusters.get(root) ?? []), slug]);
  }

  const canonicalBySlug = new Map<string, string>();
  for (const cluster of Array.from(clusters.values())) {
    const canonical = [...cluster].sort((first, second) => {
      const tokenDifference = tokens(second).length - tokens(first).length;
      if (tokenDifference !== 0) return tokenDifference;
      return (
        (clients.get(second)?.name.length ?? 0) -
        (clients.get(first)?.name.length ?? 0)
      );
    })[0];
    for (const slug of cluster) canonicalBySlug.set(slug, canonical);
  }
  return canonicalBySlug;
}

function cleanCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return String(value).replace(/\u00a0/g, ' ').trim();
}

function parseSheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][];

  return rawRows.map((row) => row.map((cell) => cleanCellValue(cell)));
}

function classifyCreditHeaderCell(headerValue: string): CreditCanonicalColumn | null {
  const normalized = normalizeText(headerValue)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return null;
  }

  if (normalized === 'balance' || normalized.includes('saldo')) return 'balance';
  if (
    normalized.includes('number of analyses') ||
    normalized.includes('n analyses') ||
    normalized.includes('analyses') ||
    normalized.includes('analises')
  ) {
    return 'analyses';
  }
  if (
    normalized === 'cost' ||
    normalized.includes('custo') ||
    normalized.includes('unit cost') ||
    normalized.includes('price')
  ) {
    return 'cost';
  }
  if (normalized === 'date' || normalized.includes('data')) return 'date';
  if (
    normalized === 'equipment' ||
    normalized.includes('equipamento') ||
    normalized.includes('instrument')
  ) {
    return 'equipment';
  }
  if (
    normalized === 'comment' ||
    normalized.includes('coment') ||
    normalized.includes('obs')
  ) {
    return 'comment';
  }

  return null;
}

function findCreditHeaderRow(rows: string[][]): number | null {
  let bestIndex: number | null = null;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const mapped = new Set<CreditCanonicalColumn>();
    for (const cell of row) {
      const column = classifyCreditHeaderCell(cell);
      if (column) {
        mapped.add(column);
      }
    }

    let score = mapped.size;
    if (mapped.has('balance')) score += 1;
    if (mapped.has('cost')) score += 1;
    if (mapped.has('analyses')) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestScore >= 3 ? bestIndex : null;
}

function buildCreditColumnMap(headerRow: string[]): CreditColumnMap {
  const mapping: CreditColumnMap = {};
  headerRow.forEach((cellValue, columnIndex) => {
    const canonicalColumn = classifyCreditHeaderCell(cellValue);
    if (!canonicalColumn || mapping[canonicalColumn] !== undefined) {
      return;
    }
    mapping[canonicalColumn] = columnIndex;
  });
  return mapping;
}

function parseNumericValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed.replace(/[^\d,.-]/g, '');
  if (!sanitized) {
    return null;
  }

  let normalized = sanitized;
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSheetDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const excelSerial = Number.parseFloat(trimmed);
  if (Number.isFinite(excelSerial) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsedDateCode = XLSX.SSF.parse_date_code(excelSerial);
    if (parsedDateCode) {
      return buildIsoDate(parsedDateCode.y, parsedDateCode.m, parsedDateCode.d);
    }
  }

  const directDate = new Date(trimmed);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate.toISOString().slice(0, 10);
  }

  const dayFirst = trimmed.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (dayFirst) {
    const day = Number.parseInt(dayFirst[1] ?? '', 10);
    const month = Number.parseInt(dayFirst[2] ?? '', 10);
    const yearRaw = Number.parseInt(dayFirst[3] ?? '', 10);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return buildIsoDate(year, month, day);
  }

  return null;
}

function inferCreditEventType(
  analysesCount: number | null,
  unitCost: number | null,
  comment: string | null
): CreditEventType {
  if (analysesCount !== null) {
    if (analysesCount > 0) {
      return 'analysis';
    }
    if (analysesCount < 0) {
      return 'credit_topup';
    }
  }

  const normalizedComment = normalizeText(comment ?? '');
  if (normalizedComment.includes('credit') || normalizedComment.includes('credito')) {
    return 'credit_topup';
  }

  return 'adjustment';
}

function inferEventAmount(
  analysesCount: number | null,
  unitCost: number | null
): number | null {
  if (analysesCount !== null && unitCost !== null) {
    return -analysesCount * Math.abs(unitCost);
  }
  return unitCost;
}

function looksLikeCreditSpreadsheet(fileName: string, extension: string): boolean {
  if (!CREDIT_SPREADSHEET_EXTENSIONS.has(extension.toLowerCase())) {
    return false;
  }

  const normalizedName = normalizeText(fileName);
  return normalizedName.includes('credit') || normalizedName.includes('credito');
}

function extractCreditEventsFromRows(
  rows: string[][],
  context: {
    clientName: string;
    clientFolderSlug: string;
    sourceRelativePath: string;
    sourceSheet: string;
  }
): ExtractedClientCreditEvent[] {
  const headerRowIndex = findCreditHeaderRow(rows);
  if (headerRowIndex === null) {
    return [];
  }

  const headerRow = rows[headerRowIndex] ?? [];
  const columnMap = buildCreditColumnMap(headerRow);
  if (columnMap.balance === undefined) {
    return [];
  }

  const parsedRows: Array<{
    sourceRow: number;
    balance: number | null;
    analysesCount: number | null;
    equipment: string | null;
    unitCost: number | null;
    eventDate: string | null;
    comment: string | null;
    hasEventFields: boolean;
  }> = [];
  let lastKnownCost: number | null = null;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const readCell = (column?: number): string =>
      column === undefined ? '' : cleanCellValue(row[column]);

    const balance = parseNumericValue(readCell(columnMap.balance));
    const analysesCount = parseNumericValue(readCell(columnMap.analyses));
    const equipment = readCell(columnMap.equipment) || null;
    const parsedCost = parseNumericValue(readCell(columnMap.cost));
    const eventDate = parseSheetDate(readCell(columnMap.date));
    const comment = readCell(columnMap.comment) || null;

    const unitCost =
      parsedCost ?? (analysesCount !== null && analysesCount !== 0 ? lastKnownCost : null);
    if (parsedCost !== null) {
      lastKnownCost = parsedCost;
    }

    const hasEventFields =
      analysesCount !== null ||
      Boolean(equipment) ||
      parsedCost !== null ||
      Boolean(eventDate) ||
      Boolean(comment);

    parsedRows.push({
      sourceRow: rowIndex + 1,
      balance,
      analysesCount,
      equipment,
      unitCost,
      eventDate,
      comment,
      hasEventFields,
    });
  }

  const events: ExtractedClientCreditEvent[] = [];
  let lastKnownBalance: number | null = null;
  for (let rowIndex = 0; rowIndex < parsedRows.length; rowIndex += 1) {
    const row = parsedRows[rowIndex];
    if (!row.hasEventFields) {
      if (row.balance !== null) lastKnownBalance = row.balance;
      continue;
    }

    const nextBalance =
      parsedRows
        .slice(rowIndex + 1)
        .find((candidate) => candidate.balance !== null)?.balance ?? null;
    const balanceBefore: number | null = row.balance ?? lastKnownBalance;
    const eventType = inferCreditEventType(
      row.analysesCount,
      row.unitCost,
      row.comment
    );
    const amount = inferEventAmount(row.analysesCount, row.unitCost);

    events.push({
      clientName: context.clientName,
      clientFolderSlug: context.clientFolderSlug,
      sourceRelativePath: context.sourceRelativePath,
      sourceSheet: context.sourceSheet,
      sourceRow: row.sourceRow,
      eventType: CREDIT_EVENT_TYPES.includes(eventType) ? eventType : 'adjustment',
      eventDate: row.eventDate,
      analysesCount: row.analysesCount,
      equipment: row.equipment,
      unitCost: row.unitCost,
      amount,
      balanceBefore,
      balanceAfter: nextBalance,
      comment: row.comment,
    });

    lastKnownBalance = nextBalance ?? balanceBefore;
  }

  return events;
}

function extractCreditEventsFromWorkbook(
  absolutePath: string,
  context: {
    clientName: string;
    clientFolderSlug: string;
    sourceRelativePath: string;
  }
): ExtractedClientCreditEvent[] {
  const workbook = XLSX.readFile(absolutePath, {
    cellDates: false,
    cellText: false,
  });

  const events: ExtractedClientCreditEvent[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = parseSheetRows(sheet);
    const sheetEvents = extractCreditEventsFromRows(rows, {
      ...context,
      sourceSheet: sheetName,
    });
    events.push(...sheetEvents);
  }

  return events;
}

function buildExtractionStats(
  clients: ExtractedClient[],
  documents: ExtractedDocument[],
  creditEvents: ExtractedClientCreditEvent[]
): ExtractionStats {
  const byCategory = buildEmptyCategoryRecord();
  const byYear: Record<string, number> = {};
  let totalFileSizeBytes = 0;

  for (const document of documents) {
    byCategory[document.category] += 1;
    totalFileSizeBytes += document.fileSizeBytes;
    const yearKey = String(document.year ?? 'unknown');
    byYear[yearKey] = (byYear[yearKey] ?? 0) + 1;
  }

  return {
    totalClients: clients.length,
    totalDocuments: documents.length,
    totalFileSizeBytes,
    byCategory,
    byYear,
    totalCreditEvents: creditEvents.length,
  };
}

export async function extractClientiData(
  clientiRootPath: string
): Promise<ExtractionSnapshot> {
  const files = await walkFiles(clientiRootPath);
  const documents: ExtractedDocument[] = [];
  const creditEvents: ExtractedClientCreditEvent[] = [];
  const warnings: string[] = [];
  const clientMap = new Map<string, ClientAccumulator>();

  for (const absolutePath of files) {
    const relativePath = normalizePathSeparators(
      path.relative(clientiRootPath, absolutePath)
    );
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length < 2) {
      continue;
    }

    const fileName = path.basename(absolutePath);
    if (fileName.startsWith('._')) {
      continue;
    }

    const extension = path.extname(fileName).toLowerCase();
    const year = parseYear(segments[0]);
    const clientName = cleanDisplayName(segments[1] ?? 'Unknown Client');
    const folderSlug = slugify(clientName);
    const category = inferCategory(fileName);
    const inferredDocumentDate = inferDateFromFileName(fileName);
    const inferredDocumentNumber = inferDocumentNumber(fileName);
    const fileStats = await stat(absolutePath);

    documents.push({
      clientName,
      clientFolderSlug: folderSlug,
      year,
      relativePath,
      absolutePath,
      fileName,
      extension,
      category,
      inferredDocumentNumber,
      inferredDocumentDate,
      fileSizeBytes: fileStats.size,
    });

    if (looksLikeCreditSpreadsheet(fileName, extension)) {
      try {
        creditEvents.push(
          ...extractCreditEventsFromWorkbook(absolutePath, {
            clientName,
            clientFolderSlug: folderSlug,
            sourceRelativePath: relativePath,
          })
        );
      } catch (error) {
        warnings.push(
          `Unable to parse credit spreadsheet ${relativePath}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    const clientAccumulator = clientMap.get(folderSlug) ?? {
      name: clientName,
      folderSlug,
      firstSeenYear: year,
      lastSeenYear: year,
      totalDocuments: 0,
      categories: new Set<DocumentCategory>(),
    };

    clientAccumulator.totalDocuments += 1;
    clientAccumulator.categories.add(category);

    if (year !== null) {
      if (clientAccumulator.firstSeenYear === null) {
        clientAccumulator.firstSeenYear = year;
      } else {
        clientAccumulator.firstSeenYear = Math.min(
          clientAccumulator.firstSeenYear,
          year
        );
      }

      if (clientAccumulator.lastSeenYear === null) {
        clientAccumulator.lastSeenYear = year;
      } else {
        clientAccumulator.lastSeenYear = Math.max(clientAccumulator.lastSeenYear, year);
      }
    }

    clientMap.set(folderSlug, clientAccumulator);
  }

  const canonicalBySlug = buildCanonicalClientSlugMap(clientMap);
  const mergedClientMap = new Map<string, ClientAccumulator>();
  for (const client of Array.from(clientMap.values())) {
    const canonicalSlug = canonicalBySlug.get(client.folderSlug) ?? client.folderSlug;
    const canonicalClient = clientMap.get(canonicalSlug) ?? client;
    const merged = mergedClientMap.get(canonicalSlug) ?? {
      ...canonicalClient,
      totalDocuments: 0,
      categories: new Set<DocumentCategory>(),
    };
    merged.totalDocuments += client.totalDocuments;
    client.categories.forEach((category: DocumentCategory) =>
      merged.categories.add(category)
    );
    if (client.firstSeenYear !== null) {
      merged.firstSeenYear =
        merged.firstSeenYear === null
          ? client.firstSeenYear
          : Math.min(merged.firstSeenYear, client.firstSeenYear);
    }
    if (client.lastSeenYear !== null) {
      merged.lastSeenYear =
        merged.lastSeenYear === null
          ? client.lastSeenYear
          : Math.max(merged.lastSeenYear, client.lastSeenYear);
    }
    mergedClientMap.set(canonicalSlug, merged);
  }

  for (const document of documents) {
    const canonicalSlug =
      canonicalBySlug.get(document.clientFolderSlug) ?? document.clientFolderSlug;
    const canonicalClient = mergedClientMap.get(canonicalSlug);
    document.clientFolderSlug = canonicalSlug;
    document.clientName = canonicalClient?.name ?? document.clientName;
  }
  for (const event of creditEvents) {
    const canonicalSlug =
      canonicalBySlug.get(event.clientFolderSlug) ?? event.clientFolderSlug;
    const canonicalClient = mergedClientMap.get(canonicalSlug);
    event.clientFolderSlug = canonicalSlug;
    event.clientName = canonicalClient?.name ?? event.clientName;
  }

  const uniqueCreditEvents = new Map<string, ExtractedClientCreditEvent>();
  for (const event of creditEvents) {
    const key = [
      event.clientFolderSlug,
      event.eventDate ?? '',
      event.analysesCount ?? '',
      normalizeText(event.equipment ?? ''),
      event.unitCost ?? '',
      event.amount ?? '',
      event.balanceBefore ?? '',
      event.balanceAfter ?? '',
      normalizeText(event.comment ?? ''),
    ].join('|');
    uniqueCreditEvents.set(key, event);
  }
  const deduplicatedCreditEvents = Array.from(uniqueCreditEvents.values());

  documents.sort(sortDocuments);
  deduplicatedCreditEvents.sort(sortCreditEvents);

  const clients: ExtractedClient[] = Array.from(mergedClientMap.values())
    .map((client) => ({
      name: client.name,
      folderSlug: client.folderSlug,
      firstSeenYear: client.firstSeenYear,
      lastSeenYear: client.lastSeenYear,
      totalDocuments: client.totalDocuments,
      categories: Array.from(client.categories.values()).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const stats = buildExtractionStats(clients, documents, deduplicatedCreditEvents);

  return {
    sourceFolder: path.basename(clientiRootPath),
    extractedAt: new Date().toISOString(),
    clients,
    documents,
    creditEvents: deduplicatedCreditEvents,
    stats,
    warnings,
  };
}
