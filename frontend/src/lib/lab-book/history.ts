import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

export const LAB_ENTRY_TYPES = [
  'publication',
  'masters_delivery',
  'phd_delivery',
  'results_delivery',
  'maintenance',
  'calibration',
  'incident',
  'quality_control',
  'software',
  'infrastructure',
  'general',
] as const;

export type LabEntryType = (typeof LAB_ENTRY_TYPES)[number];

type SeedEntry = {
  sourceKey: string;
  entryType: LabEntryType;
  title: string;
  occurredAt: string;
  datePrecision: 'day' | 'month' | 'year' | 'cutoff' | 'estimated';
  status: 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  description?: string;
  reportedAt?: string;
  sourceReference: string;
  subject?: string;
  institution?: string;
  projectReference?: string;
  material?: string;
  quantity?: number;
  performedBy?: string;
  assetCode?: string;
};

type DatabaseLike = {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
};

const PORTFOLIO_SOURCE = 'P2L_productions_portfolio.xlsx';
const HISTORY_SOURCE = 'Update history.md';

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, 'docs', 'Lab history'))
    ) ?? process.cwd()
  );
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMonth(value: unknown) {
  const text = normalizeText(value);
  const match = text.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!match) return null;
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const month = months[match[1].toLowerCase()];
  if (!month) return null;
  const year = 2000 + Number(match[2]);
  return `${year}-${String(month).padStart(2, '0')}-01T12:00:00.000Z`;
}

function splitNames(value: unknown) {
  return normalizeText(value).split(',').map(normalizeText).filter(Boolean);
}

function loadPortfolioEntries(): SeedEntry[] {
  const workbookPath = path.join(
    findRepositoryRoot(),
    'docs',
    'Lab history',
    PORTFOLIO_SOURCE
  );
  if (!fs.existsSync(workbookPath)) return [];

  const workbook = XLSX.read(fs.readFileSync(workbookPath), {
    type: 'buffer',
    cellDates: true,
  });
  const resultsSheet = workbook.Sheets.Results;
  const publicationsSheet = workbook.Sheets.Publications;
  if (!resultsSheet || !publicationsSheet) return [];

  const results = XLSX.utils.sheet_to_json<unknown[]>(resultsSheet, {
    header: 1,
    raw: false,
    defval: null,
  });
  const publications = XLSX.utils.sheet_to_json<unknown[]>(publicationsSheet, {
    header: 1,
    raw: false,
    defval: null,
  });
  const entries: SeedEntry[] = [];

  for (let index = 8; index < results.length; index += 1) {
    const row = results[index] ?? [];
    const occurredAt = parseMonth(row[5]);
    const projectReference = normalizeText(row[0]);
    const quantity = Number(normalizeText(row[1]).replace(/,/g, ''));
    const material = normalizeText(row[2]);
    const subject = normalizeText(row[3]);
    const institution = normalizeText(row[4]);
    if (!occurredAt || !projectReference || !Number.isFinite(quantity))
      continue;
    entries.push({
      sourceKey: `portfolio:result:${index + 1}`,
      entryType: 'results_delivery',
      title: `${projectReference} · ${quantity.toLocaleString('en-US')} analyses`,
      occurredAt,
      datePrecision: 'month',
      status: 'completed',
      description: `${material || 'Material not specified'} results recorded for ${subject || 'recipient not specified'}.`,
      sourceReference: `${PORTFOLIO_SOURCE} · Results row ${index + 1}`,
      subject: subject || undefined,
      institution: institution || undefined,
      projectReference,
      material: material || undefined,
      quantity,
      performedBy: 'P2L laboratory',
      assetCode: 'IRMS-01',
    });
  }

  for (let index = 1; index < publications.length; index += 1) {
    const row = publications[index] ?? [];
    const year = Number(normalizeText(row[0]));
    const authors = normalizeText(row[1]);
    const title = normalizeText(row[2]);
    const source = normalizeText(row[3]);
    if (!year || !title) continue;
    entries.push({
      sourceKey: `portfolio:publication:${index + 1}`,
      entryType: 'publication',
      title,
      occurredAt: `${year}-01-01T12:00:00.000Z`,
      datePrecision: 'year',
      status: 'completed',
      description: [authors, source].filter(Boolean).join('\n\n'),
      sourceReference: `${PORTFOLIO_SOURCE} · Publications row ${index + 1}`,
      subject: authors,
      institution: source,
    });
  }

  const academicGroups: Array<{
    rowIndex: number;
    type: 'masters_delivery' | 'phd_delivery';
    label: string;
  }> = [
    { rowIndex: 2, type: 'masters_delivery', label: 'MSc dissertation' },
    { rowIndex: 3, type: 'phd_delivery', label: 'PhD thesis' },
  ];
  for (const group of academicGroups) {
    const names = splitNames(results[group.rowIndex]?.[2]);
    names.forEach((name, index) => {
      entries.push({
        sourceKey: `portfolio:${group.type}:${index + 1}`,
        entryType: group.type,
        title: `${group.label} · ${name}`,
        occurredAt: '2023-12-31T12:00:00.000Z',
        datePrecision: 'cutoff',
        status: 'completed',
        description:
          'Listed as concluded or ongoing at the portfolio cutoff. The source does not provide an individual delivery date or distinguish concluded from ongoing records.',
        sourceReference: `${PORTFOLIO_SOURCE} · Results row ${group.rowIndex + 1}`,
        subject: name,
      });
    });
  }

  entries.push({
    sourceKey: 'portfolio:quality:phd-count',
    entryType: 'general',
    title: 'Portfolio source note · PhD count mismatch',
    occurredAt: '2023-12-31T12:00:00.000Z',
    datePrecision: 'cutoff',
    status: 'completed',
    description:
      'The portfolio summary reports 9 PhD theses but lists 10 names. All listed names were retained in the reconstructed record for review.',
    sourceReference: `${PORTFOLIO_SOURCE} · Results row 4`,
  });

  return entries;
}

const emailEntries: SeedEntry[] = [
  {
    sourceKey: 'email:2024-09-10:bellow-capillaries',
    entryType: 'maintenance',
    title: 'Leaking bellow and capillaries replaced',
    occurredAt: '2024-09-09T12:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2024-09-10T11:40:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari and Leandro',
    description:
      'Replaced the leaking bellow and all capillaries, then adjusted the capillary crimps. The event date is reconstructed from “yesterday” in the 10 September email.',
    sourceReference: `${HISTORY_SOURCE} · email 2024-09-10`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2024-09-10:dual-inlet-calibration',
    entryType: 'calibration',
    title: 'Dual Inlet recalibrated after capillary replacement',
    occurredAt: '2024-09-09T15:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2024-09-10T11:40:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari and Leandro',
    description:
      'Crimp adjustment and Dual Inlet recalibration followed the hardware replacement. A preliminary zero-enrichment test returned near-perfect pressure adjustment.',
    sourceReference: `${HISTORY_SOURCE} · email 2024-09-10`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2024-09-10:power-instability',
    entryType: 'infrastructure',
    title: 'Testing paused while nobreak protection was unavailable',
    occurredAt: '2024-09-10T09:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2024-09-10T11:40:00-03:00',
    status: 'in_progress',
    description:
      'Grid power drops shut down the computer, high voltage, and filament current while the nobreak was in standby. High vacuum was largely preserved because pumps restarted automatically. Repair was scheduled for the following Monday; completion is not confirmed by the source.',
    sourceReference: `${HISTORY_SOURCE} · email 2024-09-10`,
    assetCode: 'UPS-01',
  },
  {
    sourceKey: 'email:2026-01-27:qtegra-transition',
    entryType: 'software',
    title: 'Instrument workflow transitioned to Qtegra workstation',
    occurredAt: '2026-01-27T12:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-01-27T16:41:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari',
    description:
      'The new computer setup was fully adopted. Early Qtegra software produced freezes, diagnostics errors, broken multi-line Excel exports, configuration errors, and timeouts. Leandro supplied an update; remaining issues were controlled with operating workarounds.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-01-27`,
    assetCode: 'QTEGRA-WS',
  },
  {
    sourceKey: 'email:2026-01-27:precision-loss',
    entryType: 'incident',
    title: 'Intermittent precision deterioration after year-end hiatus',
    occurredAt: '2026-01-27T12:30:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-01-27T16:41:00-03:00',
    status: 'in_progress',
    performedBy: 'Stefano Crivellari',
    description:
      'Standards were not reproducing consistently and precision deteriorated to approximately 0.10–0.12‰. Diagnostics did not identify a leak or other clear cause. Acid-block reconstruction and filament replacement were retained as fallback interventions.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-01-27`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-02-26:precision-recovered',
    entryType: 'quality_control',
    title: 'MAT–Kiel running precision recovered to 0.04‰',
    occurredAt: '2026-02-26T10:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-02-26T10:12:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari',
    description:
      'Running precision was reported as 0.04‰ for both δ13C and δ18O, indicating recovery from the intermittent January performance problem.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-02-26`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-02-26:natan-450',
    entryType: 'results_delivery',
    title: 'Natan coral series · 450 analyses milestone',
    occurredAt: '2026-02-26T10:05:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-02-26T10:12:00-03:00',
    status: 'in_progress',
    description:
      'Approximately 450 samples had been analyzed at an average throughput of 3.3 carousels per week. Work was paused temporarily to prioritize the Petrobras DGL-1634 batch.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-02-26`,
    subject: 'Prof. Natan Pereira',
    institution: 'Bahia Federal University',
    projectReference: 'Natan coral series',
    material: 'Coral colony',
    quantity: 450,
    performedBy: 'Stefano Crivellari',
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-02-26:dgl-priority',
    entryType: 'general',
    title: 'DGL-1634 batch prioritized for Petrobras report',
    occurredAt: '2026-02-26T10:10:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-02-26T10:12:00-03:00',
    status: 'in_progress',
    description:
      'An approximately 80-sample batch was moved ahead of the queue so data could be included in a report due in the first week of March.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-02-26`,
    subject: 'Petrobras',
    institution: 'Petrobras',
    projectReference: 'DGL-1634',
    material: 'Foraminifera',
    quantity: 80,
  },
  {
    sourceKey: 'email:2026-03-16:natan-600',
    entryType: 'results_delivery',
    title: 'Natan coral series · approximately 600 results released for use',
    occurredAt: '2026-03-16T18:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-03-16T18:38:00-03:00',
    status: 'in_progress',
    description:
      'About 600 results produced a readable coral isotope curve with annual cyclicity, a marked Suess effect, and longer-term δ18O variability. The series was incomplete, but the partial data were made available while higher-priority samples were addressed.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-03-16`,
    subject: 'Prof. Natan Pereira',
    institution: 'Bahia Federal University',
    projectReference: 'Natan coral series',
    material: 'Coral colony',
    quantity: 600,
    performedBy: 'Stefano Crivellari',
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-06-08:acid-line',
    entryType: 'maintenance',
    title: 'Acid line replaced and external leak resolved',
    occurredAt: '2026-06-03T12:00:00.000Z',
    datePrecision: 'estimated',
    reportedAt: '2026-06-08T14:30:00-03:00',
    status: 'completed',
    performedBy: 'Leandro',
    description:
      'The acid line was replaced during the week before the email, completely resolving the external acid leak. The acid block was also removed and washed, requiring weekend standby/pumping to remove humidity. The displayed event date is an estimate within that prior week.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-06-08`,
    assetCode: 'KIEL-01',
  },
  {
    sourceKey: 'email:2026-06-08:vacuum-break',
    entryType: 'incident',
    title: 'MAT vacuum broken after compressed-air pressure drop',
    occurredAt: '2026-06-08T10:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-06-08T14:30:00-03:00',
    status: 'in_progress',
    performedBy: 'Stefano Crivellari with remote assistance from Leonardo',
    description:
      'A loose fast connector on the compressed-air tube operating a Kiel acid valve reduced pressure enough to open pneumatic valves near the ion source, breaking vacuum. The connector was reseated and air pressure restored, but vacuum restart remained unsuccessful.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-06-08`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-06-08:rough-pump',
    entryType: 'maintenance',
    title: 'Ion-source rough-vacuum pump replacement prepared',
    occurredAt: '2026-06-08T11:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-06-08T14:30:00-03:00',
    status: 'scheduled',
    performedBy: 'Stefano Crivellari / Leandro',
    description:
      'The remaining old backing pump was difficult to restart because of a repeatedly faulty startup capacitor. A replacement pump was available; an imported inlet adapter was ordered from two vendors with an expected one-to-two-week lead time.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-06-08`,
    assetCode: 'ROUGH-PUMP-01',
  },
  {
    sourceKey: 'email:2026-06-08:igor-results',
    entryType: 'results_delivery',
    title: 'Substantial batch of Igor results delivered',
    occurredAt: '2026-06-08T12:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-06-08T14:30:00-03:00',
    status: 'completed',
    description:
      'A substantial batch had already been produced and communicated. The email does not state the exact sample count or core identifiers.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-06-08`,
    subject: 'Prof. Igor Venancio',
    institution: 'Fluminense Federal University',
    performedBy: 'Stefano Crivellari',
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-07-08:changeover-leak',
    entryType: 'maintenance',
    title: 'Changeover leak resolved',
    occurredAt: '2026-07-02T12:00:00.000Z',
    datePrecision: 'estimated',
    reportedAt: '2026-07-08T13:50:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari',
    description:
      'The changeover leak was repaired during the week before the email. The analyzer vacuum was intentionally broken for the intervention and the system was subsequently pumped down. The displayed event date is estimated within that week.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-07-08`,
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-07-08:shp2l-contamination',
    entryType: 'quality_control',
    title: 'Initial SHP2L runs showed low δ13C internal precision',
    occurredAt: '2026-07-03T12:00:00.000Z',
    datePrecision: 'estimated',
    reportedAt: '2026-07-08T13:50:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari',
    description:
      'The first post-repair SHP2L samples showed low δ13C internal precision, consistent with contamination near the recently handled changeover valve. Analysis was paused for an additional weekend pumpdown.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-07-08`,
    projectReference: 'SHP2L',
    assetCode: 'IRMS-01',
  },
  {
    sourceKey: 'email:2026-07-08:normal-operation',
    entryType: 'quality_control',
    title: 'Analyses resumed with normal performance after pumpdown',
    occurredAt: '2026-07-06T09:00:00.000Z',
    datePrecision: 'day',
    reportedAt: '2026-07-08T13:50:00-03:00',
    status: 'completed',
    performedBy: 'Stefano Crivellari',
    description:
      'Following the weekend pumpdown, analyses resumed on Monday and the system was reported to be behaving normally.',
    sourceReference: `${HISTORY_SOURCE} · email 2026-07-08`,
    assetCode: 'IRMS-01',
  },
];

async function ensureAssets(database: DatabaseLike) {
  const assets = [
    [
      'IRMS-01',
      'MAT–Kiel isotope analysis system',
      'Thermo Fisher Scientific',
      'Instrument room',
    ],
    [
      'KIEL-01',
      'Kiel carbonate preparation device',
      'Thermo Fisher Scientific',
      'Instrument room',
    ],
    [
      'QTEGRA-WS',
      'Qtegra instrument workstation',
      'Thermo Fisher Scientific',
      'Instrument room',
    ],
    ['UPS-01', 'Instrument nobreak / UPS', null, 'Instrument room'],
    ['ROUGH-PUMP-01', 'Ion-source rough-vacuum pump', null, 'Instrument room'],
  ] as const;
  for (const [code, name, manufacturer, location] of assets) {
    await database.query(
      `INSERT INTO public.equipment_assets (asset_code, name, manufacturer, location, status, notes)
       VALUES ($1, $2, $3, $4, 'active', 'Reconstructed from the historical laboratory correspondence.')
       ON CONFLICT (asset_code) DO NOTHING`,
      [code, name, manufacturer, location]
    );
  }
  const result = await database.query<{ id: string; asset_code: string }>(
    `SELECT id, asset_code FROM public.equipment_assets
     WHERE asset_code IN ('IRMS-01', 'KIEL-01', 'QTEGRA-WS', 'UPS-01', 'ROUGH-PUMP-01')`
  );
  return new Map(result.rows.map((row) => [row.asset_code, row.id]));
}

export async function seedLabBookHistory(database: DatabaseLike) {
  const importKey = 'portfolio-and-email-v1';
  const imported = await database.query<{ import_key: string }>(
    'SELECT import_key FROM app_local.lab_book_history_imports WHERE import_key = $1',
    [importKey]
  );
  if (imported.rows.length) return;

  const assetIds = await ensureAssets(database);
  const entries = [...loadPortfolioEntries(), ...emailEntries];
  for (const entry of entries) {
    await database.query(
      `INSERT INTO public.lab_book_entries (
        source_key, entry_type, title, occurred_at, date_precision, reported_at,
        asset_id, status, performed_by, description, source_reference, subject,
        institution, project_reference, material, quantity
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) ON CONFLICT DO NOTHING`,
      [
        entry.sourceKey,
        entry.entryType,
        entry.title,
        entry.occurredAt,
        entry.datePrecision,
        entry.reportedAt ?? null,
        entry.assetCode ? (assetIds.get(entry.assetCode) ?? null) : null,
        entry.status,
        entry.performedBy ?? null,
        entry.description ?? null,
        entry.sourceReference,
        entry.subject ?? null,
        entry.institution ?? null,
        entry.projectReference ?? null,
        entry.material ?? null,
        entry.quantity ?? null,
      ]
    );
  }
  await database.query(
    `INSERT INTO app_local.lab_book_history_imports (import_key, record_count)
     VALUES ($1, $2) ON CONFLICT (import_key) DO NOTHING`,
    [importKey, entries.length]
  );
}
