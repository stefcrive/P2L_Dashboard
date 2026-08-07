import 'server-only';

import * as nodeFs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  MATERIAL_TYPES,
  type ExtractedMaterial,
  type MaterialType,
  type MaterialsExtractionSnapshot,
  type MaterialsExtractionStats,
} from '@/lib/materials/types';

const xlsxWithFs = XLSX as typeof XLSX & {
  set_fs?: (fs: typeof nodeFs) => void;
};
xlsxWithFs.set_fs?.(nodeFs);

const SUPPORTED_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);

type CanonicalColumn =
  | 'item'
  | 'description'
  | 'partNumber'
  | 'quantity'
  | 'reference'
  | 'unitPrice'
  | 'totalPrice';

interface ParsedQuantity {
  quantity: number | null;
  unit: string | null;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function parseCurrency(value: string): number | null {
  if (!value) {
    return null;
  }

  const sanitized = value.replace(/[^\d,.-]/g, '');
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

function parseQuantity(quantityText: string): ParsedQuantity {
  if (!quantityText) {
    return { quantity: null, unit: null };
  }

  const match = quantityText.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) {
    return { quantity: null, unit: null };
  }

  const normalizedNumber = match[0].replace(',', '.');
  const quantity = Number.parseFloat(normalizedNumber);
  if (!Number.isFinite(quantity)) {
    return { quantity: null, unit: null };
  }

  const unitCandidate = quantityText
    .replace(match[0], '')
    .replace(/[()[\]{}]/g, ' ')
    .trim();

  return {
    quantity,
    unit: unitCandidate || null,
  };
}

function normalizePartNumber(value: string): string | null {
  const normalized = value
    .replace(/^["'#]+|["'#]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function isOrdinalItem(value: string): boolean {
  return /^\s*\d{1,3}\s*[.)-]?\s*$/.test(value);
}

function formatMaterialName(value: string): string {
  const cleaned = value
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s*([,;/])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return cleaned;
  const letters = cleaned.match(/[a-z]/gi) ?? [];
  const uppercaseLetters = letters.filter(
    (letter) => letter === letter.toUpperCase()
  ).length;
  if (letters.length > 0 && uppercaseLetters / letters.length < 0.65) {
    return cleaned;
  }

  const protectedTokens = new Set([
    'IRMS',
    'MAT253',
    'CO2',
    'LN2',
    'H2O',
    'SENS',
    'USP',
    'ISO',
    'QTEGRA',
    'KIEL',
    'VITON',
    'PTFE',
    'PEEK',
  ]);
  return cleaned
    .toLowerCase()
    .split(' ')
    .map((word) => {
      const bare = word.replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (protectedTokens.has(bare) || /^[A-Z]+\d+[A-Z0-9]*$/.test(bare)) {
        return word.replace(/[a-z0-9]+/i, bare);
      }
      if (/^o-ring[,;.]?$/i.test(word)) return word.replace(/o-ring/i, 'O-ring');
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function inferCurrency(fileName: string, sheetName: string | null): string {
  const normalized = normalizeText(`${fileName} ${sheetName ?? ''}`);
  if (normalized.includes('reais') || normalized.includes('brl')) return 'BRL';
  if (normalized.includes('importacao direta')) return 'EUR';
  return 'BRL';
}

function classifyHeaderCell(headerValue: string): CanonicalColumn | null {
  const normalized = normalizeText(headerValue);
  if (!normalized) {
    return null;
  }

  if (normalized.includes('materialkurztext')) return 'item';
  if (normalized === 'material') return 'partNumber';
  if (
    normalized === 'pn' ||
    normalized.includes('p/n') ||
    normalized.includes('part number') ||
    normalized.includes('codigo') ||
    normalized.includes('code')
  ) {
    return 'partNumber';
  }
  if (normalized.includes('description') || normalized.includes('descri')) {
    return 'description';
  }
  if (normalized.includes('quantia') || normalized.includes('quantity')) {
    return 'quantity';
  }
  if (normalized === 'qtd' || normalized === 'qtde') {
    return 'quantity';
  }
  if (normalized.includes('reference') || normalized === 'ref' || normalized === 'ref.') {
    return 'reference';
  }
  if (normalized === 'link') {
    return 'reference';
  }
  if (
    normalized.includes('valor unt') ||
    normalized.includes('valor unit') ||
    normalized.includes('unit price')
  ) {
    return 'unitPrice';
  }
  if (
    normalized.includes('valor total') ||
    normalized.includes('valor item') ||
    normalized.includes('total price')
  ) {
    return 'totalPrice';
  }
  if (normalized === 'item') {
    return 'item';
  }

  return null;
}

function findHeaderRow(rows: string[][]): number | null {
  let bestIndex: number | null = null;
  let bestScore = -1;

  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] ?? [];
    const mapped = new Set<CanonicalColumn>();

    for (const cell of row) {
      const column = classifyHeaderCell(cell);
      if (column) {
        mapped.add(column);
      }
    }

    let score = mapped.size;
    if (mapped.has('item')) score += 1;
    if (mapped.has('partNumber')) score += 1;
    if (mapped.has('quantity')) score += 1;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 3 ? bestIndex : null;
}

function buildColumnIndexMap(headerRow: string[]): Partial<Record<CanonicalColumn, number>> {
  const mapping: Partial<Record<CanonicalColumn, number>> = {};

  headerRow.forEach((cellValue, columnIndex) => {
    const column = classifyHeaderCell(cellValue);
    if (!column || mapping[column] !== undefined) {
      return;
    }
    mapping[column] = columnIndex;
  });

  return mapping;
}

function inferMaterialType(context: string): MaterialType {
  const normalized = normalizeText(context);

  const spareTerms = [
    'spare',
    'gasket',
    'o-ring',
    'oring',
    'membrane',
    'piston',
    'seal',
    'screw',
    'valve',
    'kit',
    'ferrule',
    'filament',
    'lamp',
    'capillary',
    'reservoir',
    'frit',
    'fitting',
    'nut',
    'carbodevice',
  ];
  if (spareTerms.some((term) => normalized.includes(term))) {
    return 'spare_part';
  }

  const consumableTerms = [
    'acid',
    'acido',
    'gas',
    'helio',
    'co2',
    'silica',
    'stannous',
    'chloride',
    'vermiculita',
    'tubo',
    'tube',
    'vial',
    'tin ',
    'refil',
    'ln2',
    'loctite',
    'silicone',
    'adesivo',
    'adesive',
  ];
  if (consumableTerms.some((term) => normalized.includes(term))) {
    return 'consumable';
  }

  const equipmentTerms = [
    'software',
    'qtegra',
    'nobreak',
    'roteador',
    'router',
    'mouse',
    'notebook',
    'monitor',
    'computer',
    'treinamento',
    'training',
  ];
  if (equipmentTerms.some((term) => normalized.includes(term))) {
    return 'equipment';
  }

  return 'other';
}

function inferEquipment(context: string): string {
  const normalized = normalizeText(context);

  if (normalized.includes('kiel')) return 'Kiel IV';
  if (normalized.includes('mat253') || normalized.includes('253 plus')) {
    return 'MAT253 Plus';
  }
  if (normalized.includes('hipace 80')) return 'HiPace 80';
  if (normalized.includes('hipace 300')) return 'HiPace 300';
  if (normalized.includes('qtegra')) return 'Qtegra';
  if (normalized.includes('irms')) return 'IRMS';
  if (normalized.includes('petrobras')) return 'Petrobras project';

  return 'General Lab';
}

function buildNormalizedKey(
  partNumber: string | null,
  name: string,
  description: string | null
): string {
  const partKey = normalizeText(partNumber ?? '').replace(/[^a-z0-9]+/g, '');
  const canonicalPartKey = /^\d+$/.test(partKey)
    ? partKey.replace(/^0+(?=\d)/, '')
    : partKey;
  const nameKey = normalizeText(name || description || '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return canonicalPartKey
    ? `pn::${canonicalPartKey}`
    : `name::${nameKey || 'unnamed'}`;
}

function shouldIgnoreRow(name: string, description: string | null): boolean {
  const normalized = normalizeText(`${name} ${description ?? ''}`);
  if (!normalized) {
    return true;
  }
  if (normalized === 'item') {
    return true;
  }
  return normalized.startsWith('total');
}

function sourcePriority(fileName: string): number {
  const normalized = normalizeText(fileName);
  if (normalized.includes('main list')) return 100;
  if (normalized.includes('lista material laboratorio')) return 90;
  if (normalized.includes('material lab')) return 85;
  if (normalized.includes('lista de compra')) return 80;
  if (normalized.includes('orcamento') || normalized.includes('quotation')) return 70;
  if (normalized.includes('bremen')) return 40;
  return 60;
}

async function walkSpreadsheetFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkSpreadsheetFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(extension)) {
      files.push(absolutePath);
    }
  }

  return files;
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

function extractRowsFromSheet(
  rows: string[][],
  fileName: string,
  sheetName: string | null,
  sourcePath: string
): ExtractedMaterial[] {
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === null) {
    return [];
  }

  const headerRow = rows[headerIndex] ?? [];
  const columnMap = buildColumnIndexMap(headerRow);

  if (
    columnMap.item === undefined &&
    columnMap.description === undefined &&
    columnMap.partNumber === undefined
  ) {
    return [];
  }

  const materials: ExtractedMaterial[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const readCell = (column?: number): string =>
      column === undefined ? '' : cleanCellValue(row[column]);

    const itemRaw = readCell(columnMap.item);
    const descriptionRaw = readCell(columnMap.description);
    const partNumber = normalizePartNumber(readCell(columnMap.partNumber));
    const quantityText = readCell(columnMap.quantity) || null;
    const supplierReference = readCell(columnMap.reference) || null;
    const unitPrice = parseCurrency(readCell(columnMap.unitPrice));
    const totalPrice = parseCurrency(readCell(columnMap.totalPrice));

    const primaryName =
      !itemRaw || isOrdinalItem(itemRaw) ? descriptionRaw : itemRaw;
    const name = formatMaterialName(primaryName || descriptionRaw || '');
    if (!name && !partNumber && !quantityText && !supplierReference) {
      continue;
    }
    if (shouldIgnoreRow(name, descriptionRaw || null)) {
      continue;
    }

    const description =
      descriptionRaw && descriptionRaw !== name ? descriptionRaw : null;
    const quantity = parseQuantity(quantityText ?? '');
    const context = `${name} ${description ?? ''} ${fileName} ${sheetName ?? ''}`;
    const materialType = inferMaterialType(context);
    const equipment = inferEquipment(context);
    const normalizedKey = buildNormalizedKey(partNumber, name, description);

    materials.push({
      normalizedKey,
      name,
      partNumber,
      description,
      materialType,
      equipment,
      quantityText,
      suggestedStock: quantity.quantity,
      unit: quantity.unit,
      supplierReference,
      sourceFile: fileName,
      sourceSheet: sheetName,
      sourcePath,
      unitPrice,
      totalPrice,
      currency: inferCurrency(fileName, sheetName),
    });
  }

  return materials;
}

function mergeMaterials(materials: ExtractedMaterial[]): ExtractedMaterial[] {
  const mergedByKey = new Map<string, ExtractedMaterial & { __priority: number }>();

  for (const material of materials) {
    const key = material.normalizedKey;
    const priority = sourcePriority(material.sourceFile);
    const current = mergedByKey.get(key);

    if (!current) {
      mergedByKey.set(key, { ...material, __priority: priority });
      continue;
    }

    const shouldReplacePrimaryFields = priority > current.__priority;

    if (shouldReplacePrimaryFields) {
      current.name = material.name;
      current.description = material.description ?? current.description;
      current.sourceFile = material.sourceFile;
      current.sourceSheet = material.sourceSheet;
      current.sourcePath = material.sourcePath;
      current.__priority = priority;
    }

    if (!current.partNumber && material.partNumber) {
      current.partNumber = material.partNumber;
    }
    if (!current.description && material.description) {
      current.description = material.description;
    }
    if (!current.quantityText && material.quantityText) {
      current.quantityText = material.quantityText;
    }
    if (
      current.suggestedStock === null ||
      (material.suggestedStock !== null && material.suggestedStock > current.suggestedStock)
    ) {
      current.suggestedStock = material.suggestedStock;
    }
    if (!current.unit && material.unit) {
      current.unit = material.unit;
    }
    if (!current.supplierReference && material.supplierReference) {
      current.supplierReference = material.supplierReference;
    }
    if (current.materialType === 'other' && material.materialType !== 'other') {
      current.materialType = material.materialType;
    }
    if (
      (!current.equipment || current.equipment === 'General Lab') &&
      material.equipment &&
      material.equipment !== 'General Lab'
    ) {
      current.equipment = material.equipment;
    }
    if (!current.unitPrice && material.unitPrice) {
      current.unitPrice = material.unitPrice;
    }
    if (!current.totalPrice && material.totalPrice) {
      current.totalPrice = material.totalPrice;
    }
    if (!current.currency && material.currency) {
      current.currency = material.currency;
    }
  }

  return Array.from(mergedByKey.values())
    .map(({ __priority: _, ...material }) => material)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildZeroTypeRecord(): Record<MaterialType, number> {
  return MATERIAL_TYPES.reduce((accumulator, type) => {
    accumulator[type] = 0;
    return accumulator;
  }, {} as Record<MaterialType, number>);
}

function buildStats(materials: ExtractedMaterial[]): MaterialsExtractionStats {
  const byType = buildZeroTypeRecord();
  const byEquipment: Record<string, number> = {};
  let consumablesWithStock = 0;

  for (const material of materials) {
    byType[material.materialType] += 1;
    const equipment = material.equipment ?? 'General Lab';
    byEquipment[equipment] = (byEquipment[equipment] ?? 0) + 1;

    if (material.materialType === 'consumable' && material.suggestedStock !== null) {
      consumablesWithStock += 1;
    }
  }

  return {
    totalMaterials: materials.length,
    byType,
    byEquipment,
    consumablesWithStock,
  };
}

export async function extractMantainanceMaterials(
  mantainanceRootPath: string
): Promise<MaterialsExtractionSnapshot> {
  const spreadsheetFiles = await walkSpreadsheetFiles(mantainanceRootPath);
  const collectedMaterials: ExtractedMaterial[] = [];
  const warnings: string[] = [];

  for (const absolutePath of spreadsheetFiles) {
    const relativePath = normalizePathSeparators(
      path.relative(mantainanceRootPath, absolutePath)
    );
    const fileName = path.basename(absolutePath);

    try {
      const workbook = XLSX.readFile(absolutePath, {
        cellDates: false,
        cellText: false,
      });

      const normalizedFileName = normalizeText(fileName);
      const preferredSheets =
        normalizedFileName.includes('bremen') || normalizedFileName.includes('spares&consumables')
          ? workbook.SheetNames.filter((sheetName) =>
              normalizeText(sheetName).includes('pricelist')
            )
          : [];
      const sheetNamesToParse =
        preferredSheets.length > 0 ? preferredSheets : workbook.SheetNames;

      for (const sheetName of sheetNamesToParse) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          continue;
        }

        const rows = parseSheetRows(sheet);
        const extracted = extractRowsFromSheet(
          rows,
          fileName,
          sheetName,
          relativePath
        );
        collectedMaterials.push(...extracted);
      }
    } catch (error) {
      warnings.push(
        `Unable to parse ${relativePath}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  const materials = mergeMaterials(collectedMaterials);
  const stats = buildStats(materials);

  return {
    sourceFolder: path.basename(mantainanceRootPath),
    extractedAt: new Date().toISOString(),
    materials,
    stats,
    warnings,
  };
}
