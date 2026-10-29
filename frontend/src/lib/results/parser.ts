import 'server-only';

import * as XLSX from 'xlsx';

export type ResultFileMetadata = {
  fileName: string;
  clientCandidate: string;
  analysisSeries: string;
  resultDate: string | null;
  resultYear: number | null;
};

export type ParsedResultMeasurement = {
  identifier1: string;
  identifier2: string;
  identifier2Order: number | null;
  species: string | null;
  d13cValue: number | null;
  d13cUncertainty: number | null;
  d18oValue: number | null;
  d18oUncertainty: number | null;
  correctedD13c: number | null;
  correctedD18o: number | null;
  method: string | null;
  observation: string | null;
  sourceSheet: string;
  sourceRow: number;
};

export type ParsedResultWorkbook = {
  measurements: ParsedResultMeasurement[];
  warnings: string[];
  identifier1Count: number;
  speciesCount: number;
};

type ClientIdentity = {
  id: string;
  name: string;
};

type ColumnMap = {
  identifier1: number;
  identifier2: number | null;
  species: number | null;
  method: number | null;
  observation: number | null;
  d13cValue: number | null;
  d13cUncertainty: number | null;
  d18oValue: number | null;
  d18oUncertainty: number | null;
  correctedD13c: number | null;
  correctedD18o: number | null;
};

const CLIENT_BOUNDARY_WORDS = new Set([
  'stable',
  'series',
  'result',
  'results',
  'isotope',
  'isotopes',
  'benthic',
  'benthics',
  'planktic',
  'planktics',
  'planktonic',
  'coral',
  'corals',
  'otolith',
  'foraminifera',
  'top',
  'corrected',
  'repeated',
  'addendum',
  'extra',
]);

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeResultClientIdentity(value: string) {
  return normalizeText(value);
}

export function slugifyResultClient(value: string) {
  return normalizeText(value).replace(/\s+/g, '-') || 'unknown-client';
}

function cleanDisplayName(value: string) {
  return value
    .replace(/^edit\s+/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIsoDate(year: number, month: number, day: number) {
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

function parseCompactDate(value: string) {
  if (!/^\d{8}$/.test(value)) return null;
  const candidates = [
    [Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6, 8))],
    [Number(value.slice(4, 8)), Number(value.slice(2, 4)), Number(value.slice(0, 2))],
    [Number(value.slice(0, 4)), Number(value.slice(6, 8)), Number(value.slice(4, 6))],
  ];
  for (const [year, month, day] of candidates) {
    if (year >= 2000 && year <= 2100) {
      const parsed = buildIsoDate(year, month, day);
      if (parsed) return parsed;
    }
  }
  return null;
}

function inferResultDate(stem: string) {
  const compactDates = stem.match(/(?<!\d)\d{8}(?!\d)/g) ?? [];
  for (const value of compactDates.reverse()) {
    const parsed = parseCompactDate(value);
    if (parsed) return parsed;
  }
  return null;
}

function isClientBoundaryToken(token: string) {
  const normalized = normalizeText(token);
  if (!normalized) return false;
  if (CLIENT_BOUNDARY_WORDS.has(normalized)) return true;
  if (/^v\d+$/i.test(token)) return true;
  if (/\d/.test(token)) return true;
  if (/^[A-Z]{2,}(?:[-_].*)?$/.test(token)) return true;
  if (/^[A-Z]\.?$/.test(token)) return true;
  return false;
}

function inferClientCandidate(stem: string) {
  const withoutEdit = stem.replace(/^edit\s+/i, '').trim();
  const tokens = withoutEdit.split(/\s+/);
  const nameTokens: string[] = [];
  for (const token of tokens) {
    if (nameTokens.length > 0 && isClientBoundaryToken(token)) break;
    nameTokens.push(token);
  }
  return cleanDisplayName(nameTokens.join(' ')) || 'Unknown client';
}

function inferAnalysisSeries(stem: string, clientCandidate: string) {
  let working = stem.replace(/^edit\s+/i, '').trim();
  if (normalizeText(working).startsWith(normalizeText(clientCandidate))) {
    working = working.slice(clientCandidate.length).trim();
  }
  working = working
    .replace(/(?<!\d)\d{8}(?!\d)(?:\(\d+\))?/g, ' ')
    .replace(/\bP2L\b/gi, ' ')
    .replace(/\b(?:addendum|extra)\b/gi, ' ');
  const stableBoundary = working.search(
    /\b(?:stable\s+c\s*[&7]\s*o|c\s*&\s*o\s+stable|c\s*&\s*o\s+isotopes?|stable\s+isotopes?)/i
  );
  if (stableBoundary >= 0) working = working.slice(0, stableBoundary);
  working = working
    .replace(/\b(?:results?|isotopes?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return working || 'Stable C & O isotopes';
}

export function parseResultFileName(fileName: string): ResultFileMetadata {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  const resultDate = inferResultDate(stem);
  const clientCandidate = inferClientCandidate(stem);
  return {
    fileName,
    clientCandidate,
    analysisSeries: inferAnalysisSeries(stem, clientCandidate),
    resultDate,
    resultYear: resultDate ? Number(resultDate.slice(0, 4)) : null,
  };
}

function identityTokens(value: string) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function isTokenSubset(first: string[], second: string[]) {
  return first.every((token) => second.includes(token));
}

function levenshtein(first: string, second: string) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex];
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      current[secondIndex] = Math.min(
        (current[secondIndex - 1] ?? 0) + 1,
        (previous[secondIndex] ?? 0) + 1,
        (previous[secondIndex - 1] ?? 0) +
          (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[second.length] ?? Math.max(first.length, second.length);
}

export function buildCanonicalResultClientMap(candidates: string[]) {
  const counts = new Map<string, number>();
  const displayByNormalized = new Map<string, string>();
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    if (!displayByNormalized.has(normalized)) {
      displayByNormalized.set(normalized, cleanDisplayName(candidate));
    }
  }

  const normalizedCandidates = Array.from(counts.keys());
  const canonical = new Map<string, string>();
  for (const candidate of normalizedCandidates) {
    const tokens = identityTokens(candidate);
    const related = normalizedCandidates.filter((other) => {
      if (candidate === other) return true;
      const otherTokens = identityTokens(other);
      if (isTokenSubset(tokens, otherTokens)) {
        return true;
      }
      return (
        tokens.length === otherTokens.length &&
        tokens[0] === otherTokens[0] &&
        levenshtein(candidate, other) <= 2
      );
    });
    const selected = related.sort((first, second) => {
      const countDifference = (counts.get(second) ?? 0) - (counts.get(first) ?? 0);
      if (countDifference !== 0) return countDifference;
      const tokenDifference =
        identityTokens(second).length - identityTokens(first).length;
      if (tokenDifference !== 0) return tokenDifference;
      return first.length - second.length;
    })[0];
    canonical.set(
      candidate,
      displayByNormalized.get(selected) ?? displayByNormalized.get(candidate) ?? candidate
    );
  }
  return canonical;
}

export function matchExistingResultClient(
  candidate: string,
  clients: ClientIdentity[]
) {
  const normalizedCandidate = normalizeText(candidate);
  const exact = clients.find(
    (client) => normalizeText(client.name) === normalizedCandidate
  );
  if (exact) return exact;

  const candidateTokens = identityTokens(candidate);
  const fuzzyPrefix = clients.filter((client) => {
    const clientTokens = identityTokens(client.name);
    if (clientTokens.length > candidateTokens.length) return false;
    return clientTokens.every(
      (token, index) => levenshtein(token, candidateTokens[index] ?? '') <= 1
    );
  });
  if (fuzzyPrefix.length === 1) return fuzzyPrefix[0];
  if (fuzzyPrefix.length > 1) {
    return [...fuzzyPrefix].sort(
      (first, second) =>
        identityTokens(second.name).length - identityTokens(first.name).length
    )[0];
  }

  const related = clients.filter((client) => {
    const clientTokens = identityTokens(client.name);
    return (
      isTokenSubset(candidateTokens, clientTokens) ||
      isTokenSubset(clientTokens, candidateTokens)
    );
  });
  if (related.length === 1) return related[0];
  if (related.length > 1) {
    return [...related].sort((first, second) => {
      const firstTokens = identityTokens(first.name);
      const secondTokens = identityTokens(second.name);
      const firstDistance = Math.abs(firstTokens.length - candidateTokens.length);
      const secondDistance = Math.abs(secondTokens.length - candidateTokens.length);
      return firstDistance - secondDistance || second.name.length - first.name.length;
    })[0];
  }

  const fuzzy = clients
    .map((client) => ({
      client,
      distance: levenshtein(normalizedCandidate, normalizeText(client.name)),
    }))
    .filter(({ distance }) => distance <= 2)
    .sort((first, second) => first.distance - second.distance);
  return fuzzy[0]?.client ?? null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .replace(/[δΔ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findColumn(
  headers: unknown[],
  predicate: (normalized: string, raw: string) => boolean
) {
  const index = headers.findIndex((header) =>
    predicate(normalizeHeader(header), String(header ?? ''))
  );
  return index >= 0 ? index : null;
}

function buildColumnMap(headers: unknown[]): ColumnMap | null {
  const identifier1 = findColumn(
    headers,
    (normalized) =>
      normalized === 'identifier' || normalized.includes('core identifier')
  );
  if (identifier1 === null) return null;

  const d13cValue = findColumn(
    headers,
    (normalized) =>
      normalized.includes('d13c') &&
      normalized.includes('mean') &&
      !normalized.includes('corrected')
  );
  const d18oValue = findColumn(
    headers,
    (normalized) =>
      normalized.includes('d18o') &&
      normalized.includes('mean') &&
      !normalized.includes('corrected')
  );
  if (d13cValue === null || d18oValue === null) return null;

  const identifier2 = findColumn(headers, (normalized) =>
    normalized.includes('sample')
  );
  let species = findColumn(
    headers,
    (normalized, raw) =>
      normalized.includes('species') ||
      (/ies$/i.test(raw.trim()) && !normalized.includes('analyses'))
  );
  if (species === null) {
    const start = (identifier2 ?? identifier1) + 1;
    for (let index = start; index < d13cValue; index += 1) {
      const normalized = normalizeHeader(headers[index]);
      if (
        normalized &&
        !['row', 'method', 'date', 'time', 'observations', 'comment'].includes(
          normalized
        )
      ) {
        species = index;
        break;
      }
    }
  }

  return {
    identifier1,
    identifier2,
    species,
    method: findColumn(headers, (normalized) => normalized === 'method'),
    observation: findColumn(headers, (normalized) =>
      ['observations', 'observation', 'comment', 'info'].includes(normalized)
    ),
    d13cValue,
    d13cUncertainty: findColumn(
      headers,
      (normalized) =>
        normalized.includes('d13c') &&
        normalized.includes('std dev') &&
        !normalized.includes('corrected')
    ),
    d18oValue,
    d18oUncertainty: findColumn(
      headers,
      (normalized) =>
        normalized.includes('d18o') &&
        normalized.includes('std dev') &&
        !normalized.includes('corrected')
    ),
    correctedD13c: findColumn(
      headers,
      (normalized) =>
        normalized.includes('corrected') && normalized.includes('d13c')
    ),
    correctedD18o: findColumn(
      headers,
      (normalized) =>
        normalized.includes('corrected') && normalized.includes('d18o')
    ),
  };
}

function cleanCell(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = cleanCell(value).replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCombinedIdentifier(value: string) {
  const match = value.match(
    /^(.+?)\s+((?:\d+(?:[./-]\d+)*(?:\s*cm)?|[A-Za-z]{1,5}\d+(?:[./-]\d+)?))$/i
  );
  if (!match) return null;
  return { identifier1: match[1].trim(), identifier2: match[2].trim() };
}

function identifierOrder(value: string) {
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readColumn(row: unknown[], column: number | null) {
  return column === null ? null : row[column];
}

export function parseResultWorkbook(
  bytes: Uint8Array,
  fileName: string
): ParsedResultWorkbook {
  const workbook = XLSX.read(bytes, {
    type: 'array',
    cellDates: false,
    cellText: false,
  });
  const measurements: ParsedResultMeasurement[] = [];
  const warnings: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as unknown[][];
    const headerRowIndex = rows
      .slice(0, 30)
      .findIndex((row) => buildColumnMap(row) !== null);
    if (headerRowIndex < 0) continue;
    const columns = buildColumnMap(rows[headerRowIndex] ?? []);
    if (!columns) continue;

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      let identifier1 = cleanCell(readColumn(row, columns.identifier1));
      let identifier2 = cleanCell(readColumn(row, columns.identifier2));
      if (!identifier2 && identifier1) {
        const split = splitCombinedIdentifier(identifier1);
        if (split) {
          identifier1 = split.identifier1;
          identifier2 = split.identifier2;
        }
      }

      const d13cValue = parseNumber(readColumn(row, columns.d13cValue));
      const d18oValue = parseNumber(readColumn(row, columns.d18oValue));
      const correctedD13c = parseNumber(readColumn(row, columns.correctedD13c));
      const correctedD18o = parseNumber(readColumn(row, columns.correctedD18o));
      if (
        !identifier1 ||
        [d13cValue, d18oValue, correctedD13c, correctedD18o].every(
          (value) => value === null
        )
      ) {
        continue;
      }
      if (!identifier2) identifier2 = String(rowIndex - headerRowIndex);

      measurements.push({
        identifier1,
        identifier2,
        identifier2Order: identifierOrder(identifier2),
        species: cleanCell(readColumn(row, columns.species)) || null,
        d13cValue,
        d13cUncertainty: parseNumber(
          readColumn(row, columns.d13cUncertainty)
        ),
        d18oValue,
        d18oUncertainty: parseNumber(
          readColumn(row, columns.d18oUncertainty)
        ),
        correctedD13c,
        correctedD18o,
        method: cleanCell(readColumn(row, columns.method)) || null,
        observation:
          cleanCell(readColumn(row, columns.observation)) || null,
        sourceSheet: sheetName,
        sourceRow: rowIndex + 1,
      });
    }
  }

  if (measurements.length === 0) {
    warnings.push(`No result rows were found in ${fileName}.`);
  }
  const identifiers = new Set(
    measurements.map((measurement) => measurement.identifier1)
  );
  const species = new Set(
    measurements
      .map((measurement) => measurement.species)
      .filter((value): value is string => Boolean(value))
  );
  return {
    measurements,
    warnings,
    identifier1Count: identifiers.size,
    speciesCount: species.size,
  };
}
