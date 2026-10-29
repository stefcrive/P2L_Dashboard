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
const EXCLUDED_SOURCE_FILES = new Set(['spares&consumables bremen.xlsx']);

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

function canonicalPartKey(value: string | null): string {
  const key = normalizeText(value ?? '').replace(/[^a-z0-9]+/g, '');
  const normalized = /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
  return normalized === '754960' || normalized.includes('bre0000957')
    ? 'bre0000957'
    : normalized;
}

const CANONICAL_NAME_BY_PART = new Map<string, string>([
  ['453750', 'Nylon screw, ISO 1207 M3 × 6'],
  ['520910', 'Front ferrule, 1/16 in tube OD'],
  ['520940', 'Rear ferrule, 1/16 in stainless steel'],
  ['545270', 'Gold gasket, OD38 × ID36.5'],
  ['551600', 'Gold gasket, OD117 × ID115'],
  ['553140', 'Sealing-ring set'],
  ['554440', 'Viton O-ring, 12.37 × 2.62 mm'],
  ['598671', 'PTFE gasket, 11.9 × 9 × 0.25 mm (pack of 3)'],
  ['653010', 'Complete membrane assembly'],
  ['653030', 'Piston'],
  ['653041', 'Gold seal tip, 3.9 mm'],
  ['672460', 'Tungsten filament'],
  ['754960', 'Sample vial, KS 19/9 × 50 mm'],
  ['783900', 'Quartz tube, 4 × 2 × 23 mm'],
  ['79622', 'Phosphoric acid, ≥99% (crystalline)'],
  ['79622500g', 'Phosphoric acid, ≥99% (crystalline)'],
  ['208256', 'Stannous chloride (200 g pack)'],
  ['208256100g', 'Stannous chloride (100 g pack)'],
  ['265640', 'Tin (Sn) (200 g pack)'],
  ['265640100g', 'Tin (Sn) (100 g pack)'],
  ['339741', 'Sulphuric acid, 99% (200 mL pack)'],
  ['339741100ml', 'Sulphuric acid, 99% (100 mL pack)'],
  ['214701500g', 'Phosphorus pentoxide, ≥99%'],
  ['1097570', 'PEEK tube, 1/16 in OD × 0.040 in ID'],
  ['1157670', 'Stainless-steel frit, 1/4 in OD × 1/32 in'],
  ['1220110', 'Halogen lamp, 20 W / 12 V (Osram)'],
  ['1275730', 'HiPace 300 operating-fluid reservoir'],
  ['1275740', 'HiPace 80 operating-fluid reservoir'],
  ['1283450', 'Acid drop counter'],
  ['1298080', 'Shut-off valve P-732'],
  ['1298090', 'No-twist fitting, 1/16 in PEEK (ZNF1PK)'],
  ['1298140', 'Long acid capillary'],
  ['1298170', 'Short flangeless nut XP-235'],
  ['1298180', 'Flangeless ferrule P-200'],
  ['1309920', 'Kiel IV new acid-valve spare set'],
  ['1322930', 'MAT 253 Plus spare-parts set'],
  ['bre0000957', 'Sample vial, KS 19/9 × 50 mm'],
  ['bre0010679', 'Kiel IV acid-supply maintenance kit'],
]);

function canonicalTextKey(value: string): string {
  return normalizeText(value)
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_NAME_BY_TEXT = new Map<string, string>([
  ['ferrule swg back 1/16 ss', 'Rear ferrule, 1/16 in stainless steel'],
  ['front ferrule tube o.d. 1/16', 'Front ferrule, 1/16 in tube OD'],
  ['frit 1/4 o.d. x 1/32 stainless steel', 'Stainless-steel frit, 1/4 in OD × 1/32 in'],
  ['no twist fitting 1/16 peek znf1pk', 'No-twist fitting, 1/16 in PEEK (ZNF1PK)'],
  ['o-ring 12.37 x 2.62 viton', 'Viton O-ring, 12.37 × 2.62 mm'],
  ['tube peek 1/16 x0.04', 'PEEK tube, 1/16 in OD × 0.040 in ID'],
  ['sample vial ks 19/9- 50 lg', 'Sample vial, KS 19/9 × 50 mm'],
  ['abastecimentos de ln2 (21600 litros)', 'Liquid nitrogen supply (21,600 L)'],
  ['nitrogenio liquido (21600 litros)', 'Liquid nitrogen supply (21,600 L)'],
  ['acido nitrico 70% pa acs', 'Nitric acid, 70%, ACS grade'],
  ['acido oxalico 2h20 pa acs', 'Oxalic acid dihydrate, ACS grade'],
  ['adesivos loctite 416', 'Loctite 416 adhesive'],
  ['gas argonio', 'High-purity argon gas'],
  ['gas co2 ultrapuro', 'Ultra-high-purity CO2 gas'],
  ['gas helio ultrapuro 99.999%', 'Ultra-high-purity helium gas (99.999%)'],
  ['tubo pu 4 0 x 2 5 azul', 'Blue PU tube, 4.0 × 2.5 mm'],
  ['tubo pu 6 0 x 4 0 azul', 'Blue PU tube, 6.0 × 4.0 mm'],
  ['chloridric acid 37%', 'Hydrochloric acid, 37%'],
  ['graxa silicone', 'Silicone grease'],
  ['vermiculita', 'Vermiculite'],
  ['silicone 5966 grey henkel henkel', 'Henkel Loctite SI 5966 grey silicone sealant'],
  ['macarico manual vonder para gas mapp', 'Vonder hand torch for MAPP gas'],
  ['refil para macarico gas mapp 400g', 'MAPP gas refill (400 g)'],
  ['co2 ultrapura (comparavel com o butijao que ja temos conectado na frente do mat253)', 'Ultra-high-purity CO2 gas'],
  ['gas co2 ultrapuro (comparavel com o butijao que ja temos conectado na frente do mat253)', 'Ultra-high-purity CO2 gas'],
  ['gas argon (comparavel com butijao marrom azul que ja temos)', 'High-purity argon gas'],
  ['spare parts dual inlet', 'MAT 253 Plus dual-inlet spare-parts set'],
  ['spare parts dual inlet (hipace ab 03 12)', 'MAT 253 Plus dual-inlet spare-parts set'],
].map(([key, value]) => [canonicalTextKey(key), value]));

function cleanMaterialText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+-\s+R\$\s*[\d.,]+\s*$/i, '')
    .replace(/^\s*["']+|["']+\s*$/g, '')
    .replace(/"{2,}/g, '"')
    .replace(/\(\/\)/g, '')
    .replace(/(\d)\s*"/g, '$1 in')
    .replace(/["']/g, '')
    .replace(/\s*([,;/])\s*/g, '$1 ')
    .replace(/\s+[xX]\s+/g, ' × ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMaterialName(value: string, partNumber: string | null = null): string {
  const canonicalByPart = CANONICAL_NAME_BY_PART.get(canonicalPartKey(partNumber));
  if (canonicalByPart) return canonicalByPart;

  const rawCleaned = cleanMaterialText(value);
  const textKey = canonicalTextKey(rawCleaned);
  const canonicalByText = CANONICAL_NAME_BY_TEXT.get(textKey);
  if (canonicalByText) return canonicalByText;
  if (textKey.startsWith('acido fosforico puriss')) {
    return 'Phosphoric acid, ≥99% (crystalline)';
  }
  if (textKey.startsWith('pentoxido fosforico')) {
    return 'Phosphorus pentoxide, ≥99%';
  }

  const cleaned = rawCleaned;
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

function isReadableMaterialName(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized || isOrdinalItem(normalized)) return false;
  if (/^(?:item|material|description|descricao|n\/?a|none|null)$/.test(normalized)) {
    return false;
  }
  const letters = normalized.match(/[a-z]/g) ?? [];
  return letters.length >= 3;
}

function looksLikeQuantityValue(value: string): boolean {
  return /^\s*\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l|mq|m³|m2|m3|m|mt|un|unit|units|unidade|unidades|pc|pcs)?(?:\s*\([^)]*\))?\s*$/i.test(
    value
  );
}

function looksLikePartCode(value: string): boolean {
  const compact = value.replace(/\s+/g, '').replace(/^['"]+|['"]+$/g, '');
  if (!compact || /^https?:/i.test(compact)) return false;
  if (/^\d{5,}$/.test(compact)) return true;
  return compact.length >= 5 && /\d/.test(compact) && /[a-z/-]/i.test(compact);
}

function shouldSwapPartAndQuantity(partValue: string, quantityValue: string): boolean {
  const compactPart = partValue.replace(/\s+/g, '');
  const isLongNumericCode = /^\d{5,}(?:\.0+)?$/.test(compactPart);
  return (
    !isLongNumericCode &&
    looksLikeQuantityValue(partValue) &&
    looksLikePartCode(quantityValue)
  );
}

function isNonMaterialService(value: string): boolean {
  return /^(?:manutencao|manutencao|maintenance|servico|service|treinamento|training)\b/.test(
    normalizeText(value)
  );
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
    'nitrogen',
    'alcool',
    'alcohol',
    'acetona',
    'ether',
    'eter ',
    'peptone',
    'pentoxide',
    'pentoxido',
    'vermicul',
    'sulfato',
    'carbonato',
    'diatomaceous',
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

  if (
    [
      'kiel',
      'carbodevice',
      'acid capillary',
      'acid drop',
      'sample vial',
      'membrane',
      'piston',
      'sealing ring',
      'stamp-au-seal',
    ].some((term) => normalized.includes(term))
  ) {
    return 'Kiel IV carbonate preparation device';
  }
  if (normalized.includes('mat253') || normalized.includes('253 plus')) {
    return 'MAT 253 Plus isotope-ratio mass spectrometry system';
  }
  if (
    [
      'hipace',
      'dual inlet',
      'filament tungsten',
      'tungsten filament',
      'gasket gold od117',
      'o-ring',
      'halogenlamp',
      'ferrule',
      'frit',
      'peek',
      'flangeless nut',
      'shut-off valve',
    ].some((term) => normalized.includes(term))
  ) {
    return 'MAT 253 Plus isotope-ratio mass spectrometry system';
  }
  if (normalized.includes('qtegra')) return 'Qtegra instrument workstation';
  if (normalized.includes('miele')) return 'Washing machine';
  if (normalized.includes('compressor') || normalized.includes('ar comprimido')) {
    return 'Air compressor';
  }
  if (normalized.includes('ar condicionado')) return 'Air conditioning';

  return 'General laboratory';
}

function inferDescription(
  name: string,
  materialType: MaterialType,
  equipment: string
): string | null {
  if (materialType !== 'consumable' && materialType !== 'spare_part') return null;
  const normalized = normalizeText(name);
  if (normalized.includes('filament')) {
    return 'Replacement tungsten filament for the MAT 253 Plus ion source.';
  }
  if (normalized.includes('sample vial')) {
    return 'Reaction/sample vial sized for the Kiel IV carbonate preparation device.';
  }
  if (normalized.includes('acid capillary')) {
    return 'Replacement capillary for the Kiel IV acid delivery path.';
  }
  if (normalized.includes('gasket') || normalized.includes('o-ring')) {
    return 'Replacement vacuum seal for leak-tight isotope-analysis system connections.';
  }
  if (
    normalized.includes('ferrule') ||
    normalized.includes('fitting') ||
    normalized.includes('nut')
  ) {
    return 'Replacement connector for small-bore gas or reagent tubing on the isotope-analysis system.';
  }
  if (normalized.includes('acid') || normalized.includes('acido')) {
    return 'Laboratory-grade acid reagent or acid-path component for sample preparation.';
  }
  if (materialType === 'spare_part') {
    return `Replacement part for preventive or corrective maintenance of ${equipment}.`;
  }
  return `Consumable used for ${equipment}.`;
}

function defaultSuggestedStock(name: string, materialType: MaterialType): number | null {
  if (materialType === 'spare_part') {
    const normalized = normalizeText(name);
    return ['o-ring', 'ferrule', 'gasket', 'screw', 'seal', 'nut'].some((term) =>
      normalized.includes(term)
    )
      ? 4
      : 1;
  }
  if (materialType === 'consumable') return 2;
  return null;
}

function buildNormalizedKey(
  partNumber: string | null,
  name: string,
  description: string | null
): string {
  const partKey = canonicalPartKey(partNumber);
  const nameKey = normalizeText(name || description || '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  return partKey
    ? `pn::${partKey}`
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

    if (EXCLUDED_SOURCE_FILES.has(entry.name.toLowerCase())) {
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
    let partNumberRaw = readCell(columnMap.partNumber);
    let quantityTextRaw = readCell(columnMap.quantity);
    if (shouldSwapPartAndQuantity(partNumberRaw, quantityTextRaw)) {
      [partNumberRaw, quantityTextRaw] = [quantityTextRaw, partNumberRaw];
    }
    const partNumber = normalizePartNumber(partNumberRaw);
    const quantityText = quantityTextRaw || null;
    const supplierReference = readCell(columnMap.reference) || null;
    const unitPrice = parseCurrency(readCell(columnMap.unitPrice));
    const totalPrice = parseCurrency(readCell(columnMap.totalPrice));

    const primaryName =
      !itemRaw || isOrdinalItem(itemRaw) ? descriptionRaw : itemRaw;
    const name = formatMaterialName(primaryName || descriptionRaw || '', partNumber);
    if (!name && !partNumber && !quantityText && !supplierReference) {
      continue;
    }
    if (
      !isReadableMaterialName(name) ||
      isNonMaterialService(name) ||
      shouldIgnoreRow(name, descriptionRaw || null)
    ) {
      continue;
    }

    const formattedDescription = descriptionRaw
      ? formatMaterialName(descriptionRaw, partNumber)
      : '';
    const description =
      formattedDescription && normalizeText(formattedDescription) !== normalizeText(name)
        ? cleanMaterialText(descriptionRaw)
        : null;
    const quantity = parseQuantity(quantityText ?? '');
    const context = `${name} ${description ?? ''} ${sheetName ?? ''}`;
    const materialType = inferMaterialType(context);
    const equipment = inferEquipment(context);
    const normalizedKey = buildNormalizedKey(partNumber, name, description);

    materials.push({
      normalizedKey,
      name,
      partNumber,
      description: description ?? inferDescription(name, materialType, equipment),
      materialType,
      equipment,
      quantityText,
      suggestedStock:
        quantity.quantity ?? defaultSuggestedStock(name, materialType),
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
  const partKeysByName = new Map<string, Set<string>>();

  for (const material of materials) {
    if (!material.partNumber) continue;
    const nameKey = normalizeText(material.name).replace(/[^a-z0-9]+/g, '');
    const keys = partKeysByName.get(nameKey) ?? new Set<string>();
    keys.add(material.normalizedKey);
    partKeysByName.set(nameKey, keys);
  }

  for (const material of materials) {
    const nameKey = normalizeText(material.name).replace(/[^a-z0-9]+/g, '');
    const matchingPartKeys = partKeysByName.get(nameKey);
    const key =
      !material.partNumber && matchingPartKeys?.size === 1
        ? Array.from(matchingPartKeys)[0]
        : material.normalizedKey;
    const priority = sourcePriority(material.sourceFile);
    const current = mergedByKey.get(key);

    if (!current) {
      mergedByKey.set(key, {
        ...material,
        normalizedKey: key,
        __priority: priority,
      });
      continue;
    }

    const currentNameQuality = isReadableMaterialName(current.name) ? 1 : 0;
    const incomingNameQuality = isReadableMaterialName(material.name) ? 1 : 0;
    const shouldReplacePrimaryFields =
      incomingNameQuality > currentNameQuality ||
      (incomingNameQuality === currentNameQuality && priority > current.__priority);

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
    .filter((material) => isReadableMaterialName(material.name))
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
