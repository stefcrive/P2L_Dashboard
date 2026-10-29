'use client';
import { postUploadForm } from '@/lib/cloud/upload-client';

import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import type { PlotParams } from 'react-plotly.js';
import {
  Download,
  Axis3D,
  ChevronDown,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FilterX,
  GripHorizontal,
  Rows3,
  Search,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
  Toolbar,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { selectClassName } from '@/lib/operations/client';
import { cn } from '@/lib/utils';

const Plot = dynamic<PlotParams>(
  () => import('react-plotly.js').then((module) => module.default),
  { ssr: false }
);

type Client = {
  id: string;
  name: string;
};

type SourceDocument = {
  id: string;
  file_name: string;
  relative_path: string;
  file_size_bytes: number;
};

type ResultFile = {
  id: string;
  client_id: string;
  source_document_id: string;
  analysis_series: string;
  result_date: string | null;
  row_count: number;
  identifier_1_count: number;
  species_count: number;
  status: 'parsed' | 'warning' | 'error';
  import_error: string | null;
  client: Client | null;
  source_document: SourceDocument | null;
};

type Measurement = {
  id: string;
  result_file_id: string;
  client_id: string;
  identifier_1: string;
  identifier_2: string;
  identifier_2_order: number | null;
  species: string | null;
  d13c_value: number | null;
  d13c_uncertainty: number | null;
  d18o_value: number | null;
  d18o_uncertainty: number | null;
  corrected_d13c: number | null;
  corrected_d18o: number | null;
  method: string | null;
  observation: string | null;
  source_sheet: string;
  source_row: number;
  client: Client | null;
};

type ResultsResponse = {
  resultFiles: ResultFile[];
  measurements: Measurement[];
  measurementCount: number;
  truncated: boolean;
  warnings: string[];
};

type ResultOptionRow = {
  result_file_id: string;
  client_id: string;
  identifier_1: string;
  identifier_2: string;
  species: string | null;
  client: Client | null;
};

type ResultOptionsResponse = {
  rows: ResultOptionRow[];
  count: number;
  truncated: boolean;
};

type FilterOption = {
  value: string;
  label: string;
  count: number;
};

type PlotAxis = 'primary' | 'secondary';
type PlotLayoutMode = 'overlay' | 'stacked';
type ChartLibrary = 'plotly' | 'recharts';
type IdentifierAxisKind = 'numeric' | 'coded' | 'categorical';

type SeriesSetting = {
  visible: boolean;
  axis: PlotAxis;
};

type SearchFilters = {
  identifier1: string[];
  identifier2: string[];
  species: string[];
  clientId: string[];
  resultFileId: string[];
};

const emptyFilters: SearchFilters = {
  identifier1: [],
  identifier2: [],
  species: [],
  clientId: [],
  resultFileId: [],
};

const speciesColours = ['#4934CB', '#B7791F', '#8273DE', '#008B78', '#5677A6'];
const rechartsLineStyles = ['', '6 3', '2 2', '8 3 2 3', '1 3'];

const plotlyLineStyles = [
  'solid',
  'dash',
  'dot',
  'dashdot',
  'longdash',
] as const;

function formatNumber(value: number | null, digits = 3) {
  if (value === null) return '—';
  return Number(value).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
  });
}

function formatFileSize(value: number) {
  if (!value) return '0 KB';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'The result operation failed.');
  }
  return payload;
}

async function fetchResults(filters: SearchFilters): Promise<ResultsResponse> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    value.forEach((item) => params.append(key, item));
  });
  const response = await fetch(
    `/api/results/data${params.size ? `?${params.toString()}` : ''}`,
    { cache: 'no-store' }
  );
  return readJson(response);
}

async function fetchResultOptions(): Promise<ResultOptionsResponse> {
  return readJson(
    await fetch('/api/results/options', {
      cache: 'no-store',
    })
  );
}

async function uploadResultFile(file: File) {
  const formData = new FormData();
  formData.set('file', file);
  return readJson(
    await postUploadForm('/api/results/upload', formData)
  );
}

async function syncResultsFolder() {
  return readJson(
    await fetch('/api/results/sync', { method: 'POST', cache: 'no-store' })
  );
}

type ChartPoint = {
  x: number;
  y: number;
  uncertainty: number | null;
  identifier1: string;
  identifier2: string;
  species: string;
  identifierAxisKind: IdentifierAxisKind;
  isPrecision?: boolean;
};

const identifierAxisLabels: Record<IdentifierAxisKind, string> = {
  numeric: 'Numeric / depth sequence',
  coded: 'Coded sample sequence',
  categorical: 'Categorical sequence',
};

const identifierAxisOrder: IdentifierAxisKind[] = [
  'numeric',
  'coded',
  'categorical',
];

const numericIdentifier2Pattern =
  /^[<>]?\s*(-?\d+(?:[.,]\d+)?)(?:\s*[-–—]\s*(-?\d+(?:[.,]\d+)?))?\s*(?:mm|cm|m|ka|kyr|yr|years?)?\s*(bis|ter|[a-z])?$/i;

function numericIdentifier2Position(value: string) {
  const match = numericIdentifier2Pattern.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1].replace(',', '.'));
  const end = match[2] ? Number(match[2].replace(',', '.')) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (start + end) / 2;
}

function numericIdentifier2Variant(value: string) {
  return numericIdentifier2Pattern.exec(value.trim())?.[3]?.toLowerCase() ?? '';
}

function classifyIdentifier2(value: string): IdentifierAxisKind {
  const normalized = value.trim();
  if (numericIdentifier2Position(normalized) !== null) return 'numeric';
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(normalized) && /\d/.test(normalized)) {
    return 'coded';
  }
  return 'categorical';
}

function countOptions(
  rows: ResultOptionRow[],
  valueForRow: (row: ResultOptionRow) => string | null,
  labelForValue?: (value: string) => string
) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = valueForRow(row)?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts, ([value, count]) => ({
    value,
    label: labelForValue?.(value) ?? value,
    count,
  })).sort((first, second) =>
    first.label.localeCompare(second.label, undefined, { numeric: true })
  );
}

function rowMatchesFilters(
  row: ResultOptionRow,
  filters: SearchFilters,
  excluded?: keyof SearchFilters
) {
  if (
    excluded !== 'clientId' &&
    filters.clientId.length &&
    !filters.clientId.includes(row.client_id)
  ) {
    return false;
  }
  if (
    excluded !== 'resultFileId' &&
    filters.resultFileId.length &&
    !filters.resultFileId.includes(row.result_file_id)
  ) {
    return false;
  }
  if (
    excluded !== 'species' &&
    filters.species.length &&
    (!row.species || !filters.species.includes(row.species))
  ) {
    return false;
  }
  if (
    excluded !== 'identifier1' &&
    filters.identifier1.length &&
    !filters.identifier1.includes(row.identifier_1)
  ) {
    return false;
  }
  if (
    excluded !== 'identifier2' &&
    filters.identifier2.length &&
    !filters.identifier2.includes(row.identifier_2)
  ) {
    return false;
  }
  return true;
}

function FilterTable({
  id,
  label,
  options,
  value,
  onChange,
  loading = false,
}: {
  id: string;
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (value: string[]) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingOptions = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(normalizedQuery)
  );
  const visibleOptions = matchingOptions.slice(0, 80);

  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background">
      <div className="flex min-h-8 items-center justify-between gap-2 border-b bg-slate-50 px-2 py-1 dark:bg-slate-900">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 className="truncate text-xs font-semibold">{label}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {value.length
              ? `${value.length} included`
              : `${options.length} available`}
          </p>
        </div>
        {value.length ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <div className="relative border-b p-1.5">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Find ${label.toLocaleLowerCase()}…`}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <div className="h-28 overflow-y-auto" aria-busy={loading}>
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Loading options…
          </p>
        ) : visibleOptions.length ? (
          <table className="w-full table-fixed text-xs">
            <colgroup><col className="w-8" /><col /><col className="w-12" /></colgroup>
            <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <tr>
                <th className="px-2 py-1 text-left font-medium text-muted-foreground">
                  <span className="sr-only">Include</span>
                </th>
                <th className="px-1 py-1 text-left font-medium text-muted-foreground">
                  Value
                </th>
                <th className="px-2 py-1 text-right font-medium text-muted-foreground">
                  Rows
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleOptions.map((option) => {
                const selected = value.includes(option.value);
                return (
                  <tr
                    key={option.value}
                    data-state={selected ? 'selected' : undefined}
                    className="border-b last:border-0 hover:bg-muted/50 data-[state=selected]:bg-blue-50 dark:data-[state=selected]:bg-blue-950/35"
                  >
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          onChange(
                            selected
                              ? value.filter((item) => item !== option.value)
                              : [...value, option.value]
                          )
                        }
                        aria-label={`${selected ? 'Exclude' : 'Include'} ${option.label}`}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </td>
                    <td
                      className="truncate px-1 py-1 font-medium"
                      title={option.label}
                    >
                      {option.label}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {option.count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query
              ? `No ${label.toLocaleLowerCase()} match “${query}”.`
              : 'No options available.'}
          </p>
        )}
      </div>
      {matchingOptions.length > visibleOptions.length ? (
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Showing 80 of {matchingOptions.length}. Use search to narrow the
          table.
        </p>
      ) : null}
    </div>
  );
}

function SeriesConfigurationTable({
  groups,
  settings,
  onChange,
}: {
  groups: Array<[string, ChartPoint[]]>;
  settings: Record<string, SeriesSetting>;
  onChange: (series: string, setting: SeriesSetting) => void;
}) {
  if (!groups.length) {
    return (
      <EmptyState
        title="No plot series available"
        description="Choose at least one item in the filter tables to build the series list."
      />
    );
  }

  return (
    <Table containerClassName="max-h-80" className="min-w-[760px]">
      <TableHeader className="sticky top-0 z-20">
        <TableRow>
          <TableHead>Series</TableHead>
          <TableHead>X-axis</TableHead>
          <TableHead className="text-right">Points</TableHead>
          <TableHead>Chart</TableHead>
          <TableHead>Y-axis</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map(([series, points], index) => {
            const identifierAxisKind =
              points[0]?.identifierAxisKind ?? 'categorical';
            const setting = settings[series] ?? {
              visible: true,
              axis: 'primary' as const,
            };
            return (
              <TableRow
                key={series}
                data-state={setting.visible ? 'selected' : undefined}
              >
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{
                        backgroundColor:
                          speciesColours[index % speciesColours.length],
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="max-w-80 truncate font-medium"
                      title={series}
                    >
                      {series}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill tone="neutral">
                    {identifierAxisLabels[identifierAxisKind]}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {points.length.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant={setting.visible ? 'secondary' : 'ghost'}
                    className="h-7 min-w-20 justify-start px-2 text-[11px]"
                    onClick={() =>
                      onChange(series, {
                        ...setting,
                        visible: !setting.visible,
                      })
                    }
                    aria-pressed={setting.visible}
                  >
                    {setting.visible ? (
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {setting.visible ? 'Included' : 'Excluded'}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="inline-flex rounded-md border bg-background p-0.5">
                    {(['primary', 'secondary'] as PlotAxis[]).map((axis) => {
                      return (
                        <button
                          key={axis}
                          type="button"
                          className={`h-6 rounded px-2 text-[11px] font-medium ${
                            setting.axis === axis
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                          onClick={() => onChange(series, { ...setting, axis })}
                          aria-pressed={setting.axis === axis}
                        >
                          {axis === 'primary' ? 'Shared' : 'Secondary'}
                        </button>
                      );
                    })}
                  </div>
                </TableCell>
              </TableRow>
            );
        })}
      </TableBody>
    </Table>
  );
}

type ChartRowSeries = {
  series: string;
  points: ChartPoint[];
  seriesIndex: number;
  setting: SeriesSetting;
};

type ChartRow = {
  key: string;
  identifierAxisKind: IdentifierAxisKind;
  series: ChartRowSeries[];
};

function buildChartRows(
  groups: Array<[string, ChartPoint[]]>,
  settings: Record<string, SeriesSetting>,
  layoutMode: PlotLayoutMode
) {
  const rows = new Map<string, ChartRow>();
  groups.forEach(([series, points], seriesIndex) => {
    const identifierAxisKind =
      points[0]?.identifierAxisKind ?? 'categorical';
    const setting = settings[series] ?? {
      visible: true,
      axis: 'primary' as const,
    };
    if (!setting.visible || !points.length) return;
    const key =
      layoutMode === 'overlay'
        ? `axis:${identifierAxisKind}`
        : `series:${series}`;
    const row = rows.get(key) ?? {
      key,
      identifierAxisKind,
      series: [],
    };
    row.series.push({ series, points, seriesIndex, setting });
    rows.set(key, row);
  });
  return Array.from(rows.values()).sort(
    (first, second) =>
      identifierAxisOrder.indexOf(first.identifierAxisKind) -
        identifierAxisOrder.indexOf(second.identifierAxisKind) ||
      first.series[0].seriesIndex - second.series[0].seriesIndex
  );
}

function sampledAxisEntries(labels: Map<number, string>, maximum = 18) {
  const entries = Array.from(labels.entries()).sort(
    ([first], [second]) => first - second
  );
  const step = Math.max(1, Math.ceil(entries.length / maximum));
  return entries.filter(
    (_, index) => index % step === 0 || index === entries.length - 1
  );
}

function sharedXAxisDomain(labels: Map<number, string>): [number, number] {
  const values = Array.from(labels.keys());
  if (!values.length) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.015, 0.5);
  return [minimum - padding, maximum + padding];
}

function bottomRowIndices(rows: ChartRow[]) {
  const indices = new Map<IdentifierAxisKind, number>();
  rows.forEach((row, index) => indices.set(row.identifierAxisKind, index));
  return indices;
}

function RechartsResultTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  metric: 'carbon' | 'oxygen';
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="max-w-72 rounded-md border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{point.species}</p>
      <p className="mt-1 text-muted-foreground">{point.identifier1}</p>
      <p className="text-muted-foreground">Identifier 2: {point.identifier2}</p>
      <p className="mt-2 font-mono font-semibold tabular-nums">
        {metric === 'carbon' ? 'δ13C' : 'δ18O'} {formatNumber(point.y)} ‰
      </p>
    </div>
  );
}

function ChartLegend({
  groups,
  settings,
  onChange,
  chartLibrary,
  showLine,
  showSymbols,
  precisionPoint,
}: {
  groups: Array<[string, ChartPoint[]]>;
  settings: Record<string, SeriesSetting>;
  onChange: (series: string, setting: SeriesSetting) => void;
  chartLibrary: ChartLibrary;
  showLine: boolean;
  showSymbols: boolean;
  precisionPoint: ChartPoint | null;
}) {
  return (
    <details className="group min-w-0 rounded-md border bg-card xl:col-span-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-panel py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>Chart legend</span>
        <span className="flex items-center gap-2">
          <span className="text-xs font-normal text-muted-foreground">
            {groups.length} series
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="border-t p-panel">
        <p className="mb-3 text-xs text-muted-foreground">
          Colours and line patterns identify each series. Select a series to show or hide it.
        </p>
        {groups.length ? (
          <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([series], index) => {
              const setting = settings[series] ?? { visible: true, axis: 'primary' as const };
              const colour = speciesColours[index % speciesColours.length];
              const dash = chartLibrary === 'plotly'
                ? ['', '6 6', '2 3', '6 3 2 3', '12 6'][index % plotlyLineStyles.length]
                : rechartsLineStyles[index % rechartsLineStyles.length];
              return (
                <li key={series} className="min-w-0">
                  <button
                    type="button"
                    className={cn('flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', !setting.visible && 'opacity-50')}
                    aria-pressed={setting.visible}
                    aria-label={`${setting.visible ? 'Hide' : 'Show'} ${series}`}
                    onClick={() => onChange(series, { ...setting, visible: !setting.visible })}
                  >
                    <svg width="36" height="16" viewBox="0 0 36 16" className="shrink-0" aria-hidden="true">
                      {showLine ? <line x1="0" x2="36" y1="8" y2="8" stroke={colour} strokeWidth="1.5" strokeDasharray={dash} /> : null}
                      {showSymbols ? <circle cx="18" cy="8" r="4" fill={colour} /> : null}
                    </svg>
                    <span className={cn('min-w-0 break-words', !setting.visible && 'line-through')}>{series}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-xs text-muted-foreground">Choose data in the filter tables to see its legend.</p>}
        {precisionPoint ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <svg width="36" height="16" viewBox="0 0 36 16" className="shrink-0" aria-hidden="true">
              <path d="M18 2v12M13 2h10M13 14h10" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="18" cy="8" r="2" fill="currentColor" />
            </svg>
            {precisionPoint.species}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function PlotlySequenceChart({
  groups,
  settings,
  layoutMode,
  precisionPoint,
  metric,
  showLine,
  showSymbols,
  showPrecision,
  symbolSize,
  xAxisLabels,
  hasSelection,
  height,
  width,
  dark,
}: {
  groups: Array<[string, ChartPoint[]]>;
  settings: Record<string, SeriesSetting>;
  layoutMode: PlotLayoutMode;
  precisionPoint: ChartPoint | null;
  metric: 'carbon' | 'oxygen';
  showLine: boolean;
  showSymbols: boolean;
  showPrecision: boolean;
  symbolSize: number;
  xAxisLabels: Map<IdentifierAxisKind, Map<number, string>>;
  hasSelection: boolean;
  height: number;
  width: number;
  dark: boolean;
}) {
  const rows = buildChartRows(groups, settings, layoutMode);
  const bottomRows = bottomRowIndices(rows);
  const metricLabel = metric === 'carbon' ? 'δ13C' : 'δ18O';
  const xAxisReference = (axisNumber: number) =>
    axisNumber === 1 ? 'x' : `x${axisNumber}`;
  const yAxisReference = (axisNumber: number) =>
    axisNumber === 1 ? 'y' : `y${axisNumber}`;
  const traces: PlotParams['data'] = [];

  rows.forEach((row, rowIndex) => {
    const xAxis = xAxisReference(rowIndex + 1);
    const primaryAxisNumber = rowIndex * 2 + 1;
    row.series.forEach(({ series, points, seriesIndex, setting }) => {
      const yAxis = yAxisReference(
        setting.axis === 'secondary' ? primaryAxisNumber + 1 : primaryAxisNumber
      );
      const colour = speciesColours[seriesIndex % speciesColours.length];
      traces.push({
        type: 'scatter',
        mode:
          showLine && showSymbols
            ? 'lines+markers'
            : showLine
              ? 'lines'
              : 'markers',
        name: series,
        xaxis: xAxis,
        yaxis: yAxis,
        x: points.map((point) => point.x),
        y: points.map((point) => point.y),
        customdata: points.map((point) => [
          point.identifier1,
          point.identifier2,
          point.uncertainty,
          setting.axis,
        ]),
        line: {
          color: colour,
          width: 1.5,
          dash: plotlyLineStyles[seriesIndex % plotlyLineStyles.length],
        },
        marker: {
          color: colour,
          size: symbolSize * 2,
          line: { color: '#ffffff', width: 1 },
        },
        hovertemplate:
          '<b>%{fullData.name}</b><br>' +
          '%{customdata[0]}<br>' +
          'Identifier 2: %{customdata[1]}<br>' +
          `${metricLabel}: %{y:.3f} ‰<br>` +
          'Precision: %{customdata[2]:.3f} ‰<br>' +
          'Axis: %{customdata[3]}<extra></extra>',
      });
    });
  });

  const firstRow = rows[0];
  if (showPrecision && precisionPoint && firstRow) {
    const firstX = Math.min(
      ...firstRow.series.flatMap(({ points }) => points.map((point) => point.x))
    );
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: precisionPoint.species,
      xaxis: 'x',
      yaxis: 'y',
      x: [firstX],
      y: [precisionPoint.y],
      marker: { color: dark ? '#cbd5e1' : '#334155', size: 5 },
      error_y: {
        type: 'data',
        array: [precisionPoint.uncertainty ?? 0],
        visible: true,
        color: dark ? '#cbd5e1' : '#334155',
        thickness: 1.5,
        width: 5,
      },
      hovertemplate: `${precisionPoint.species}<extra></extra>`,
    });
  }

  rows.forEach((row, rowIndex) => {
    const hasPrimaryData = row.series.some(
      ({ setting }) => setting.axis === 'primary'
    );
    const precisionAnchorsRow =
      rowIndex === 0 && showPrecision && Boolean(precisionPoint);
    if (!hasPrimaryData && !precisionAnchorsRow) {
      const primaryAxisNumber = rowIndex * 2 + 1;
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `Primary axis anchor ${row.key}`,
        xaxis: xAxisReference(rowIndex + 1),
        yaxis: yAxisReference(primaryAxisNumber),
        x: [null],
        y: [null],
        marker: { opacity: 0 },
        hoverinfo: 'skip',
        showlegend: false,
      });
    }
  });

  const emptyMessage = hasSelection
    ? rows.length
      ? 'No plottable measurements match these filters.'
      : 'Every series is excluded. Include a series in the table above.'
    : 'Select one or more items in the filter tables to plot measurements.';
  const rowCount = Math.max(rows.length, 1);
  // A compact default must not compress several independent axes into one row.
  const plotHeight = Math.max(height, rowCount * 160 + 42 + 56);
  const layout: NonNullable<PlotParams['layout']> = {
    autosize: true,
    height: plotHeight,
    margin: { t: 42, r: 58, b: 56, l: 64 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: dark ? '#b6c3d5' : '#475569', size: 11 },
    hovermode: 'closest',
    showlegend: false,
    annotations:
      rows.length === 0
        ? [
            {
              text: emptyMessage,
              x: 0.5,
              y: 0.5,
              xref: 'paper',
              yref: 'paper',
              showarrow: false,
              font: { color: '#697697', size: 12 },
            },
          ]
        : [],
  };

  rows.forEach((row, rowIndex) => {
    const gap = rowCount > 1 ? (layoutMode === 'stacked' ? 0.045 : 0.11) : 0;
    const domainHeight = (1 - gap * (rowCount - 1)) / rowCount;
    const upper = 1 - rowIndex * (domainHeight + gap);
    const lower = Math.max(0, upper - domainHeight);
    const xAxisNumber = rowIndex + 1;
    const primaryAxisNumber = rowIndex * 2 + 1;
    const secondaryAxisNumber = primaryAxisNumber + 1;
    const xAxis = xAxisReference(xAxisNumber);
    const primaryAxis = yAxisReference(primaryAxisNumber);
    const xAxisKey = xAxisNumber === 1 ? 'xaxis' : `xaxis${xAxisNumber}`;
    const primaryAxisKey =
      primaryAxisNumber === 1 ? 'yaxis' : `yaxis${primaryAxisNumber}`;
    const secondaryAxisKey = `yaxis${secondaryAxisNumber}`;
    const tickEntries = sampledAxisEntries(
      xAxisLabels.get(row.identifierAxisKind) ?? new Map(),
      Math.max(3, Math.min(12, Math.floor((width - 122) / 64)))
    );
    const axisLabels =
      xAxisLabels.get(row.identifierAxisKind) ?? new Map<number, string>();
    const showSharedXAxis =
      layoutMode !== 'stacked' ||
      bottomRows.get(row.identifierAxisKind) === rowIndex;
    const sharedAxisIndex = bottomRows.get(row.identifierAxisKind) ?? rowIndex;
    const rowHasSecondaryAxis = row.series.some(
      ({ setting }) => setting.axis === 'secondary'
    );
    const rowLabel =
      layoutMode === 'stacked'
        ? (row.series[0]?.series ?? identifierAxisLabels[row.identifierAxisKind])
        : identifierAxisLabels[row.identifierAxisKind];
    const axes: Record<string, unknown> = {
      [xAxisKey]: {
        title: {
          text: showSharedXAxis
            ? `Identifier 2 · ${identifierAxisLabels[row.identifierAxisKind]}`
            : '',
        },
        domain: [0, 1],
        range: sharedXAxisDomain(axisLabels),
        matches:
          layoutMode === 'stacked' && rowIndex !== sharedAxisIndex
            ? xAxisReference(sharedAxisIndex + 1)
            : undefined,
        anchor: primaryAxis,
        tickmode: 'array',
        tickvals: tickEntries.map(([value]) => value),
        ticktext: tickEntries.map(([, label]) => label),
        tickangle: 0,
        showticklabels: showSharedXAxis,
        ticks: showSharedXAxis ? 'outside' : '',
        tickfont: { size: 11 },
        automargin: true,
        showline: showSharedXAxis,
        linecolor: '#94a3b8',
        linewidth: 1,
        gridcolor: dark ? '#29394f' : '#cbd5e1',
        zeroline: false,
      },
      [primaryAxisKey]: {
        title: {
          text: `${metricLabel} (‰ VPDB)`,
        },
        domain: [lower, upper],
        gridcolor: dark ? '#29394f' : '#cbd5e1',
        zerolinecolor: '#94a3b8',
        showline: true,
        showticklabels: true,
        ticks: 'outside',
        anchor: xAxis,
      },
    };
    if (rowHasSecondaryAxis) {
      axes[secondaryAxisKey] = {
        title: {
          text: `Secondary · ${metricLabel} (‰ VPDB)`,
        },
        domain: [lower, upper],
        overlaying: primaryAxis,
        side: 'right',
        showgrid: false,
        zeroline: false,
        anchor: xAxis,
      };
    }
    Object.assign(layout, axes);
  });

  if (!rows.length) {
    return (
      <EmptyState title="No plot series included" description={emptyMessage} />
    );
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{ responsive: true, displaylogo: false }}
      style={{ width: '100%', height: `${plotHeight}px` }}
      useResizeHandler
    />
  );
}

function RechartsSequenceChart({
  groups,
  settings,
  layoutMode,
  precisionPoint,
  metric,
  showLine,
  showSymbols,
  showPrecision,
  symbolSize,
  xAxisLabels,
  hasSelection,
  height,
  width,
}: {
  groups: Array<[string, ChartPoint[]]>;
  settings: Record<string, SeriesSetting>;
  layoutMode: PlotLayoutMode;
  precisionPoint: ChartPoint | null;
  metric: 'carbon' | 'oxygen';
  showLine: boolean;
  showSymbols: boolean;
  showPrecision: boolean;
  symbolSize: number;
  xAxisLabels: Map<IdentifierAxisKind, Map<number, string>>;
  hasSelection: boolean;
  height: number;
  width: number;
}) {
  const rows = buildChartRows(groups, settings, layoutMode);
  const bottomRows = bottomRowIndices(rows);
  const metricLabel = metric === 'carbon' ? 'δ13C' : 'δ18O';
  if (!rows.length) {
    return (
      <EmptyState
        title={hasSelection ? 'No plot series included' : 'Choose data to plot'}
        description={
          hasSelection
            ? 'Include at least one series in the table above.'
            : 'Select one or more items in the filter tables to plot measurements.'
        }
      />
    );
  }

  const rowHeight =
    rows.length === 1
      ? height
      : Math.max(260, Math.floor((height - (rows.length - 1) * 16) / rows.length));

  return (
    <div className="space-y-4 overflow-y-auto" style={{ height }}>
      {rows.map((row, rowIndex) => {
        const labels = xAxisLabels.get(row.identifierAxisKind) ?? new Map();
        const ticks = sampledAxisEntries(
          labels,
          Math.max(3, Math.min(12, Math.floor((width - 150) / 64)))
        ).map(([value]) => value);
        const showSharedXAxis =
          layoutMode !== 'stacked' ||
          bottomRows.get(row.identifierAxisKind) === rowIndex;
        const hasSecondary = row.series.some(
          ({ setting }) => setting.axis === 'secondary'
        );
        const domainHasSecondary = rows.some(
          (candidateRow) =>
            candidateRow.identifierAxisKind === row.identifierAxisKind &&
            candidateRow.series.some(
              ({ setting }) => setting.axis === 'secondary'
            )
        );
        const rowLabel =
          layoutMode === 'stacked'
            ? (row.series[0]?.series ??
              identifierAxisLabels[row.identifierAxisKind])
            : identifierAxisLabels[row.identifierAxisKind];
        const firstX = Math.min(
          ...row.series.flatMap(({ points }) => points.map((point) => point.x))
        );
        const primarySeries = row.series.filter(
          ({ setting }) => setting.axis === 'primary'
        );
        const rowYValues = (
          primarySeries.length ? primarySeries : row.series
        ).flatMap(({ points }) => points.map((point) => point.y));
        const rowYMin = Math.min(...rowYValues);
        const rowYMax = Math.max(...rowYValues);
        const rowYPadding = Math.max((rowYMax - rowYMin) * 0.08, 0.1);
        const primaryDomain: [number, number] = [
          rowYMin - rowYPadding,
          rowYMax + rowYPadding,
        ];
        return (
          <section
            key={row.key}
            className="min-w-0 border-b pb-3 last:border-0"
          >
            <h4 className="px-2 pt-2 text-xs font-semibold">{rowLabel}</h4>
            <div className="w-full" style={{ height: rowHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart
                  syncId={
                    layoutMode === 'stacked'
                      ? `results-${row.identifierAxisKind}`
                      : undefined
                  }
                  margin={{
                    top: 28,
                    right: 28,
                    bottom: showSharedXAxis ? 50 : 12,
                    left: 14,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.32} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={sharedXAxisDomain(labels)}
                    allowDataOverflow
                    ticks={showSharedXAxis ? ticks : []}
                    tick={showSharedXAxis ? { fontSize: 10 } : false}
                    tickLine={showSharedXAxis}
                    axisLine={showSharedXAxis}
                    height={showSharedXAxis ? 50 : 12}
                    tickFormatter={(value) => labels.get(Number(value)) ?? ''}
                    label={
                      showSharedXAxis
                        ? {
                            value: `Identifier 2 · ${identifierAxisLabels[row.identifierAxisKind]}`,
                            position: 'insideBottom',
                            offset: -34,
                            fontSize: 11,
                          }
                        : undefined
                    }
                  />
                  <YAxis
                    yAxisId="primary"
                    type="number"
                    dataKey="y"
                    domain={primaryDomain}
                    tick={{ fontSize: 10 }}
                    tickCount={5}
                    tickFormatter={(value) => formatNumber(Number(value), 2)}
                    width={74}
                    label={{
                      value: `${metricLabel} (‰ VPDB)`,
                      angle: -90,
                      position: 'insideLeft',
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    yAxisId="secondary"
                    type="number"
                    dataKey="y"
                    orientation="right"
                    tick={hasSecondary ? { fontSize: 10 } : false}
                    tickLine={hasSecondary}
                    axisLine={hasSecondary}
                    tickCount={5}
                    tickFormatter={(value) => formatNumber(Number(value), 2)}
                    width={domainHasSecondary ? 86 : 0}
                    label={
                      hasSecondary
                        ? {
                            value: `Secondary · ${metricLabel} (‰ VPDB)`,
                            angle: 90,
                            position: 'insideRight',
                            fontSize: 11,
                          }
                        : undefined
                    }
                  />
                  <Tooltip
                    content={<RechartsResultTooltip metric={metric} />}
                  />
                  {row.series.map(
                    ({ series, points, seriesIndex, setting }) => (
                      <Scatter
                        key={series}
                        name={series}
                        data={points}
                        yAxisId={setting.axis}
                        fill={
                          speciesColours[seriesIndex % speciesColours.length]
                        }
                        line={
                          showLine
                            ? {
                                stroke:
                                  speciesColours[
                                    seriesIndex % speciesColours.length
                                  ],
                                strokeWidth: 1.5,
                                strokeDasharray:
                                  rechartsLineStyles[
                                    seriesIndex % rechartsLineStyles.length
                                  ],
                              }
                            : false
                        }
                        shape={(shapeProps: unknown) => {
                          const point = shapeProps as {
                            cx?: number;
                            cy?: number;
                            fill?: string;
                          };
                          return showSymbols &&
                            point.cx !== undefined &&
                            point.cy !== undefined ? (
                            <circle
                              cx={point.cx}
                              cy={point.cy}
                              r={symbolSize}
                              fill={point.fill}
                              stroke="white"
                              strokeWidth={1}
                            />
                          ) : (
                            <g />
                          );
                        }}
                      />
                    )
                  )}
                  {rowIndex === 0 && showPrecision && precisionPoint ? (
                    <Scatter
                      name={precisionPoint.species}
                      data={[{ ...precisionPoint, x: firstX }]}
                      yAxisId="primary"
                      fill="#334155"
                      legendType="line"
                    >
                      <ErrorBar
                        dataKey="uncertainty"
                        direction="y"
                        width={10}
                        stroke="#334155"
                        strokeWidth={1.5}
                      />
                    </Scatter>
                  ) : null}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ResizableTableViewport({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(360);
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setHeight(
      Math.min(
        1_000,
        Math.max(
          260,
          dragStart.current.height + event.clientY - dragStart.current.y
        )
      )
    );
  }

  function stopResize(event: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <>
      <div className="[&_.workspace-table]:h-full [&_.workspace-table]:max-h-none" style={{ height }}>
        {children}
      </div>
      <div
        role="separator"
        aria-label="Resize measurement table"
        aria-orientation="horizontal"
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHeight((value) => Math.min(1_000, value + 40));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHeight((value) => Math.max(260, value - 40));
          }
        }}
        className="grid h-5 cursor-row-resize place-items-center border-t bg-muted/30 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GripHorizontal className="h-4 w-4" aria-hidden="true" />
      </div>
    </>
  );
}

function ResizableChartViewport({
  children,
}: {
  children: (height: number, width: number, dark: boolean) => React.ReactNode;
}) {
  const defaultHeight = 320;
  const minimumHeight = 260;
  const maximumHeight = 1_200;
  const [height, setHeight] = useState(defaultHeight);
  const [width, setWidth] = useState(640);
  const [dark, setDark] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setWidth(viewport.clientWidth);
    const updateTheme = () =>
      setDark(document.documentElement.classList.contains('dark'));
    measure();
    updateTheme();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(viewport);
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  function clampHeight(value: number) {
    return Math.min(maximumHeight, Math.max(minimumHeight, value));
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragStart.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    setHeight(
      clampHeight(
        dragStart.current.height + event.clientY - dragStart.current.y
      )
    );
  }

  function stopResize(event: ReactPointerEvent<HTMLDivElement>) {
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="min-w-0">
      <div ref={viewportRef} className="min-w-0 overflow-auto" style={{ height }}>
        {children(height, width, dark)}
      </div>
      <div
        role="separator"
        aria-label="Resize results chart"
        aria-orientation="horizontal"
        aria-valuemin={minimumHeight}
        aria-valuemax={maximumHeight}
        aria-valuenow={height}
        tabIndex={0}
        title="Drag to resize the chart. Double-click to reset."
        onDoubleClick={() => setHeight(defaultHeight)}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHeight((value) => clampHeight(value + 40));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHeight((value) => clampHeight(value - 40));
          } else if (event.key === 'Home') {
            event.preventDefault();
            setHeight(minimumHeight);
          } else if (event.key === 'End') {
            event.preventDefault();
            setHeight(maximumHeight);
          }
        }}
        className="group grid h-7 touch-none cursor-row-resize place-items-center border-t bg-muted/30 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2 text-[11px]">
          <GripHorizontal
            className="h-4 w-4 transition-colors group-hover:text-foreground"
            aria-hidden="true"
          />
          Drag to resize · {height}px
        </span>
      </div>
    </div>
  );
}

export function ResultsDashboard() {
  const queryClient = useQueryClient();
  const sourceDocumentLinkHandled = useRef(false);
  const [linkedSourceDocumentId, setLinkedSourceDocumentId] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState('');
  const [metric, setMetric] = useState<'carbon' | 'oxygen'>('carbon');
  const [chartLibrary, setChartLibrary] = useState<ChartLibrary>('plotly');
  const [plotLayoutMode, setPlotLayoutMode] =
    useState<PlotLayoutMode>('overlay');
  const [seriesSettings, setSeriesSettings] = useState<
    Record<string, SeriesSetting>
  >({});
  const [corrected, setCorrected] = useState(true);
  const [showLine, setShowLine] = useState(true);
  const [showSymbols, setShowSymbols] = useState(true);
  const [showPrecision, setShowPrecision] = useState(true);
  const [symbolSize, setSymbolSize] = useState(3);
  const [plotSeriesExpanded, setPlotSeriesExpanded] = useState(false);

  const resultsQuery = useQuery({
    queryKey: ['result-register', filters],
    queryFn: () => fetchResults(filters),
    retry: false,
  });
  const optionsQuery = useQuery({
    queryKey: ['result-register-options'],
    queryFn: fetchResultOptions,
    retry: false,
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadResultFile,
    onSuccess: async (payload) => {
      setStatus(payload.message);
      setUploadFile(null);
      setFileInputKey((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['result-register'] }),
        queryClient.invalidateQueries({
          queryKey: ['result-register-options'],
        }),
        queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
        queryClient.invalidateQueries({
          queryKey: ['operations-header-summary'],
        }),
      ]);
    },
    onError: (error: Error) => setStatus(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: syncResultsFolder,
    onSuccess: async (payload) => {
      const issueCount =
        (payload.errors?.length ?? 0) + (payload.warnings?.length ?? 0);
      setStatus(
        `${payload.totalFiles} files checked, ${payload.importedFiles} imported, ${payload.skippedFiles} unchanged${issueCount ? `, ${issueCount} notices` : ''}.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['result-register'] }),
        queryClient.invalidateQueries({
          queryKey: ['result-register-options'],
        }),
        queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
      ]);
    },
    onError: (error: Error) => setStatus(error.message),
  });

  const data = resultsQuery.data;
  const resultFiles = useMemo(
    () => data?.resultFiles ?? [],
    [data?.resultFiles]
  );
  const measurements = useMemo(
    () => data?.measurements ?? [],
    [data?.measurements]
  );
  const optionRows = useMemo(
    () => optionsQuery.data?.rows ?? [],
    [optionsQuery.data?.rows]
  );

  const fileById = useMemo(
    () => new Map(resultFiles.map((file) => [file.id, file])),
    [resultFiles]
  );

  useEffect(() => {
    setLinkedSourceDocumentId(
      new URLSearchParams(window.location.search)
        .get('sourceDocumentId')
        ?.trim() ?? ''
    );
  }, []);

  useEffect(() => {
    if (
      sourceDocumentLinkHandled.current ||
      !linkedSourceDocumentId ||
      resultsQuery.isLoading
    ) {
      return;
    }

    sourceDocumentLinkHandled.current = true;
    const linkedFile = resultFiles.find(
      (file) => file.source_document_id === linkedSourceDocumentId
    );

    if (!linkedFile) {
      setStatus(
        'This result document has not been imported for visualization yet. Process the Results folder or upload it here.'
      );
      return;
    }

    setFilters({
      ...emptyFilters,
      clientId: [linkedFile.client_id],
      resultFileId: [linkedFile.id],
    });
    setStatus(
      `Visualizing ${linkedFile.source_document?.file_name ?? linkedFile.analysis_series}.`
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [linkedSourceDocumentId, resultFiles, resultsQuery.isLoading]);
  const clientById = useMemo(() => {
    const clients = new Map<string, string>();
    resultFiles.forEach((file) => {
      if (file.client) clients.set(file.client.id, file.client.name);
    });
    optionRows.forEach((row) => {
      if (row.client) clients.set(row.client.id, row.client.name);
    });
    return clients;
  }, [optionRows, resultFiles]);

  const clientOptions = useMemo(
    () =>
      countOptions(
        optionRows.filter((row) => rowMatchesFilters(row, filters, 'clientId')),
        (row) => row.client_id,
        (value) => clientById.get(value) ?? value
      ),
    [clientById, filters, optionRows]
  );
  const fileOptions = useMemo(
    () =>
      countOptions(
        optionRows.filter((row) =>
          rowMatchesFilters(row, filters, 'resultFileId')
        ),
        (row) => row.result_file_id,
        (value) =>
          fileById.get(value)?.source_document?.file_name ??
          fileById.get(value)?.analysis_series ??
          value
      ),
    [fileById, filters, optionRows]
  );
  const speciesOptions = useMemo(
    () =>
      countOptions(
        optionRows.filter((row) => rowMatchesFilters(row, filters, 'species')),
        (row) => row.species
      ),
    [filters, optionRows]
  );
  const identifier1Options = useMemo(
    () =>
      countOptions(
        optionRows.filter((row) =>
          rowMatchesFilters(row, filters, 'identifier1')
        ),
        (row) => row.identifier_1
      ),
    [filters, optionRows]
  );
  const identifier2Options = useMemo(
    () =>
      countOptions(
        optionRows.filter((row) =>
          rowMatchesFilters(row, filters, 'identifier2')
        ),
        (row) => row.identifier_2
      ),
    [filters, optionRows]
  );

  const matchingFileIds = useMemo(
    () =>
      new Set(
        optionRows
          .filter((row) => rowMatchesFilters(row, filters))
          .map((row) => row.result_file_id)
      ),
    [filters, optionRows]
  );
  const filteredResultFiles = useMemo(() => {
    const scientificFilterActive =
      filters.species.length > 0 ||
      filters.identifier1.length > 0 ||
      filters.identifier2.length > 0;
    return resultFiles.filter(
      (file) =>
        (!filters.clientId.length ||
          filters.clientId.includes(file.client_id)) &&
        (!filters.resultFileId.length ||
          filters.resultFileId.includes(file.id)) &&
        (!scientificFilterActive ||
          optionRows.length === 0 ||
          matchingFileIds.has(file.id))
    );
  }, [filters, matchingFileIds, optionRows.length, resultFiles]);

  const hasChartSelection = useMemo(
    () => Object.values(filters).some((value) => value.length > 0),
    [filters]
  );

  const chartGroups = useMemo(() => {
    const sorted = [...measurements].sort((first, second) => {
      const orderDifference =
        (first.identifier_2_order ?? Number.POSITIVE_INFINITY) -
        (second.identifier_2_order ?? Number.POSITIVE_INFINITY);
      if (orderDifference !== 0) return orderDifference;
      return first.identifier_2.localeCompare(second.identifier_2, undefined, {
        numeric: true,
      });
    });
    const sequenceIndexByKind = new Map<
      IdentifierAxisKind,
      Map<string, number>
    >();
    identifierAxisOrder.forEach((kind) => {
      const values = Array.from(
        new Set(
          sorted
            .filter(
              (measurement) =>
                classifyIdentifier2(measurement.identifier_2) === kind
            )
            .map((measurement) => measurement.identifier_2)
        )
      );
      sequenceIndexByKind.set(
        kind,
        new Map(values.map((identifier, index) => [identifier, index + 1]))
      );
    });
    const groups = new Map<string, ChartPoint[]>();
    sorted.forEach((measurement) => {
      const rawValue =
        metric === 'carbon' ? measurement.d13c_value : measurement.d18o_value;
      const correctedValue =
        metric === 'carbon'
          ? measurement.corrected_d13c
          : measurement.corrected_d18o;
      const uncertainty =
        metric === 'carbon'
          ? measurement.d13c_uncertainty
          : measurement.d18o_uncertainty;
      const value = corrected ? (correctedValue ?? rawValue) : rawValue;
      if (value === null) return;
      const species = measurement.species || 'Unspecified species';
      const identifier1 =
        measurement.identifier_1.trim() || 'Unspecified Identifier 1';
      const identifierAxisKind = classifyIdentifier2(measurement.identifier_2);
      const numericPosition =
        identifierAxisKind === 'numeric'
          ? numericIdentifier2Position(measurement.identifier_2)
          : null;
      const sequenceVariant =
        identifierAxisKind === 'numeric'
          ? numericIdentifier2Variant(measurement.identifier_2)
          : '';
      const series = `${species} · ${identifier1} · ${identifierAxisLabels[identifierAxisKind]}${
        sequenceVariant ? ` · ${sequenceVariant}` : ''
      }`;
      const points = groups.get(series) ?? [];
      points.push({
        x:
          numericPosition ??
          sequenceIndexByKind
            .get(identifierAxisKind)
            ?.get(measurement.identifier_2) ??
          points.length + 1,
        y: Number(value),
        uncertainty:
          uncertainty === null ? null : Math.abs(Number(uncertainty)),
        identifier1,
        identifier2: measurement.identifier_2,
        species,
        identifierAxisKind,
      });
      groups.set(series, points);
    });
    return Array.from(groups.entries());
  }, [corrected, measurements, metric]);

  const chartPoints = useMemo(
    () => chartGroups.flatMap(([, points]) => points),
    [chartGroups]
  );

  useEffect(() => {
    setSeriesSettings((current) => {
      const next: Record<string, SeriesSetting> = {};
      chartGroups.forEach(([series]) => {
        next[series] = current[series] ?? {
          visible: true,
          axis: 'primary',
        };
      });
      return next;
    });
  }, [chartGroups]);

  const precisionPoint = useMemo(() => {
    if (!chartPoints.length) return null;
    const standardPattern =
      /\b(?:standard|std|nbs|iaea|carrara|calibration|reference)\b/i;
    const standardMeasurements = measurements.filter((measurement) =>
      [
        measurement.identifier_1,
        measurement.identifier_2,
        measurement.species,
        measurement.method,
        measurement.observation,
      ].some((value) => standardPattern.test(value ?? ''))
    );
    const candidates = (
      standardMeasurements.length ? standardMeasurements : measurements
    )
      .map((measurement) =>
        metric === 'carbon'
          ? measurement.d13c_uncertainty
          : measurement.d18o_uncertainty
      )
      .filter(
        (value): value is number =>
          value !== null && Number.isFinite(value) && value >= 0
      )
      .sort((first, second) => first - second);
    if (!candidates.length) return null;
    const middle = Math.floor(candidates.length / 2);
    const precision =
      candidates.length % 2
        ? candidates[middle]
        : (candidates[middle - 1] + candidates[middle]) / 2;
    const identifierAxisKind = chartPoints[0].identifierAxisKind;
    const xValues = chartPoints
      .filter((point) => point.identifierAxisKind === identifierAxisKind)
      .map((point) => point.x);
    const yValues = chartPoints.map((point) => point.y);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    return {
      x: Math.min(...xValues),
      y: yMin + Math.max((yMax - yMin) * 0.12, precision * 1.5),
      uncertainty: precision,
      identifier1: 'Standard precision',
      identifier2: 'Reference',
      species: `Standard precision +/- ${formatNumber(precision)} per mil`,
      identifierAxisKind,
      isPrecision: true,
    } satisfies ChartPoint;
  }, [chartPoints, measurements, metric]);

  const xAxisLabels = useMemo(() => {
    const labels = new Map<IdentifierAxisKind, Map<number, string>>();
    identifierAxisOrder.forEach((kind) => labels.set(kind, new Map()));
    chartGroups.forEach(([, points]) => {
      points.forEach((point) => {
        const axisLabels = labels.get(point.identifierAxisKind);
        const currentLabel = axisLabels?.get(point.x);
        const currentLength = currentLabel?.replace(/\s+/g, '').length ?? Infinity;
        const candidateLength = point.identifier2.replace(/\s+/g, '').length;
        if (!currentLabel || candidateLength < currentLength) {
          axisLabels?.set(point.x, point.identifier2);
        }
      });
    });
    return labels;
  }, [chartGroups]);

  function clearSearch() {
    setFilters({
      identifier1: [],
      identifier2: [],
      species: [],
      clientId: [],
      resultFileId: [],
    });
  }

  function updateSeriesSetting(series: string, setting: SeriesSetting) {
    setSeriesSettings((current) => ({ ...current, [series]: setting }));
  }

  function exploreFile(file: ResultFile) {
    const nextFilters = {
      ...emptyFilters,
      resultFileId: [file.id],
      clientId: [file.client_id],
    };
    setFilters(nextFilters);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="space-y-workspace">
      <PageHeader
        title="Results register"
        actions={
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
            />
            {process.env.NEXT_PUBLIC_HOSTED === '1' ? 'Process saved workbooks' : 'Process Results folder'}
          </Button>
        }
      />

      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-panel py-2 text-xs font-medium">Import result workbook</summary>
      <Toolbar className="space-y-2 rounded-none border-0 border-t">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            key={fileInputKey}
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
            className="bg-background"
            aria-label="Choose a result workbook"
          />
          <Button
            onClick={() => uploadFile && uploadMutation.mutate(uploadFile)}
            disabled={!uploadFile || uploadMutation.isPending}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {uploadMutation.isPending
              ? 'Parsing workbook…'
              : 'Upload and import'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            The filename is used to match or create the client; the original
            workbook is retained as a result document.
          </span>
          {status ? (
            <span aria-live="polite" className="font-medium text-foreground">
              {status}
            </span>
          ) : null}
        </div>
      </Toolbar>
      </details>

      {data?.warnings?.map((warning) => (
        <p
          key={warning}
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {warning}
        </p>
      ))}

      {resultsQuery.isError || optionsQuery.isError ? (
        <EmptyState
          error
          title="The result register could not be loaded"
          description={
            (resultsQuery.error as Error | null)?.message ??
            (optionsQuery.error as Error | null)?.message ??
            'The result search data is unavailable.'
          }
        />
      ) : (
          <div className="grid items-start gap-workspace xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <SectionPanel
              title="Filter workspace"
              className="xl:col-span-2"
              description="Every available value stays visible. Check rows to include them; each selection narrows the neighboring tables."
              actions={
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {(data?.measurementCount ?? 0).toLocaleString()} matches
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearSearch}
                    disabled={!hasChartSelection}
                  >
                    <FilterX className="mr-1.5 h-3.5 w-3.5" />
                    Clear filters
                  </Button>
                </div>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <FilterTable
                  id="result-client-filter"
                  label="Client"
                  options={clientOptions}
                  value={filters.clientId}
                  onChange={(value) =>
                    setFilters({
                      ...emptyFilters,
                      clientId: value,
                    })
                  }
                  loading={optionsQuery.isLoading}
                />
                <FilterTable
                  id="result-file-filter"
                  label="Result file"
                  options={fileOptions}
                  value={filters.resultFileId}
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      resultFileId: value,
                      species: [],
                      identifier1: [],
                      identifier2: [],
                    }))
                  }
                  loading={optionsQuery.isLoading}
                />
                <FilterTable
                  id="result-species-filter"
                  label="Species"
                  options={speciesOptions}
                  value={filters.species}
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      species: value,
                      identifier1: [],
                      identifier2: [],
                    }))
                  }
                  loading={optionsQuery.isLoading}
                />
                <FilterTable
                  id="result-identifier-1-filter"
                  label="Identifier 1"
                  options={identifier1Options}
                  value={filters.identifier1}
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      identifier1: value,
                      identifier2: [],
                    }))
                  }
                  loading={optionsQuery.isLoading}
                />
                <FilterTable
                  id="result-identifier-2-filter"
                  label="Identifier 2"
                  options={identifier2Options}
                  value={filters.identifier2}
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      identifier2: value,
                    }))
                  }
                  loading={optionsQuery.isLoading}
                />
              </div>
              {data?.truncated ? (
                <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                  The measurement preview is limited to 1,000 rows. Refine the
                  tables to narrow the result set.
                </p>
              ) : null}
            </SectionPanel>

            <ChartLegend
              groups={hasChartSelection ? chartGroups : []}
              settings={seriesSettings}
              onChange={updateSeriesSetting}
              chartLibrary={chartLibrary}
              showLine={showLine}
              showSymbols={showSymbols}
              precisionPoint={hasChartSelection && showPrecision ? precisionPoint : null}
            />

            <SectionPanel
              title="Plot builder"
              description="Series with the same Identifier 2 axis combine automatically, or can be split into aligned charts."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Chart library
                    <select
                      value={chartLibrary}
                      onChange={(event) =>
                        setChartLibrary(event.target.value as ChartLibrary)
                      }
                      className={cn(selectClassName, 'h-7 w-auto min-w-24 py-0 text-[11px]')}
                    >
                      <option value="plotly">Plotly</option>
                      <option value="recharts">Recharts</option>
                    </select>
                  </label>
                  <div
                    className="inline-flex rounded-md border bg-background p-0.5"
                    aria-label="Plot layout"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        plotLayoutMode === 'overlay' ? 'secondary' : 'ghost'
                      }
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setPlotLayoutMode('overlay')}
                      aria-pressed={plotLayoutMode === 'overlay'}
                    >
                      <Axis3D className="mr-1.5 h-3.5 w-3.5" />
                      Combined
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        plotLayoutMode === 'stacked' ? 'secondary' : 'ghost'
                      }
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setPlotLayoutMode('stacked')}
                      aria-pressed={plotLayoutMode === 'stacked'}
                    >
                      <Rows3 className="mr-1.5 h-3.5 w-3.5" />
                      Stacked charts
                    </Button>
                  </div>
                  <div className="flex rounded-md border bg-muted/30 p-0.5">
                    <Button
                      size="sm"
                      variant={metric === 'carbon' ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setMetric('carbon')}
                      aria-pressed={metric === 'carbon'}
                    >
                      δ13C
                    </Button>
                    <Button
                      size="sm"
                      variant={metric === 'oxygen' ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setMetric('oxygen')}
                      aria-pressed={metric === 'oxygen'}
                    >
                      δ18O
                    </Button>
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={corrected}
                      onChange={(event) => setCorrected(event.target.checked)}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Use corrected values
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showLine}
                      onChange={(event) => {
                        setShowLine(event.target.checked);
                        if (!event.target.checked && !showSymbols) {
                          setShowSymbols(true);
                        }
                      }}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Line
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showSymbols}
                      onChange={(event) => {
                        setShowSymbols(event.target.checked);
                        if (!event.target.checked && !showLine) {
                          setShowLine(true);
                        }
                      }}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Symbols
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    Symbol size
                    <select
                      value={symbolSize}
                      onChange={(event) =>
                        setSymbolSize(Number(event.target.value))
                      }
                      className={cn(selectClassName, 'h-7 w-16 py-0 text-[11px]')}
                    >
                      {[3, 4, 5, 6, 8, 10].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showPrecision}
                      onChange={(event) =>
                        setShowPrecision(event.target.checked)
                      }
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Standard precision
                  </label>
                </div>
              }
            >
              <div className="space-y-2">
                <div className="overflow-hidden rounded-md border">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 bg-slate-50 px-2 py-1.5 text-left transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-slate-900 dark:hover:bg-slate-800"
                    aria-expanded={plotSeriesExpanded}
                    aria-controls="plot-series-settings"
                    onClick={() => setPlotSeriesExpanded((value) => !value)}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">
                        Plot series
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {hasChartSelection
                          ? chartGroups.filter(
                              ([series]) =>
                                seriesSettings[series]?.visible ?? true
                            ).length
                          : 0}{' '}
                        of {hasChartSelection ? chartGroups.length : 0} included
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          plotSeriesExpanded ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  {plotSeriesExpanded ? (
                    <div id="plot-series-settings" className="border-t">
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">Configure included series and shared or secondary axes.</p>
                      <SeriesConfigurationTable
                        groups={hasChartSelection ? chartGroups : []}
                        settings={seriesSettings}
                        onChange={updateSeriesSetting}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 overflow-hidden rounded-md border bg-slate-50/40 dark:bg-slate-950/20">
                  {hasChartSelection ? (
                  <ResizableChartViewport>
                    {(height, width, dark) =>
                      chartLibrary === 'plotly' ? (
                        <PlotlySequenceChart
                          groups={hasChartSelection ? chartGroups : []}
                          settings={seriesSettings}
                          layoutMode={plotLayoutMode}
                          precisionPoint={
                            hasChartSelection ? precisionPoint : null
                          }
                          metric={metric}
                          showLine={showLine}
                          showSymbols={showSymbols}
                          showPrecision={showPrecision}
                          symbolSize={symbolSize}
                          xAxisLabels={
                            hasChartSelection ? xAxisLabels : new Map()
                          }
                          hasSelection={hasChartSelection}
                          height={height}
                          width={width}
                          dark={dark}
                        />
                      ) : (
                        <RechartsSequenceChart
                          groups={hasChartSelection ? chartGroups : []}
                          settings={seriesSettings}
                          layoutMode={plotLayoutMode}
                          precisionPoint={
                            hasChartSelection ? precisionPoint : null
                          }
                          metric={metric}
                          showLine={showLine}
                          showSymbols={showSymbols}
                          showPrecision={showPrecision}
                          symbolSize={symbolSize}
                          xAxisLabels={
                            hasChartSelection ? xAxisLabels : new Map()
                          }
                          hasSelection={hasChartSelection}
                          height={height}
                          width={width}
                        />
                      )
                    }
                  </ResizableChartViewport>
                  ) : (
                    <EmptyState title="Choose data to plot" description="Select one or more items in the filter tables to plot measurements." />
                  )}
                </div>
              </div>
            </SectionPanel>
            <SectionPanel
              title="Measurement results"
              description={`${Math.min(measurements.length, 300)} rows shown with source-file provenance.`}
              bodyClassName="p-0"
            >
              {measurements.length ? (
                <ResizableTableViewport>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Identifier 1</TableHead>
                        <TableHead>Identifier 2</TableHead>
                        <TableHead>Species</TableHead>
                        <TableHead className="text-right">δ13C</TableHead>
                        <TableHead className="text-right">δ18O</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {measurements.slice(0, 300).map((measurement) => {
                        const file = fileById.get(measurement.result_file_id);
                        return (
                          <TableRow key={measurement.id}>
                            <TableCell className="font-medium">
                              {measurement.identifier_1}
                            </TableCell>
                            <TableCell className="font-mono tabular-nums">
                              {measurement.identifier_2}
                            </TableCell>
                            <TableCell>{measurement.species ?? '—'}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatNumber(
                                corrected
                                  ? (measurement.corrected_d13c ??
                                      measurement.d13c_value)
                                  : measurement.d13c_value
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatNumber(
                                corrected
                                  ? (measurement.corrected_d18o ??
                                      measurement.d18o_value)
                                  : measurement.d18o_value
                              )}
                            </TableCell>
                            <TableCell>
                              {file?.source_document ? (
                                <a
                                  href={`/api/client-manager/documents/${file.source_document.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex max-w-64 items-center gap-1 truncate text-xs font-medium text-primary hover:underline"
                                >
                                  {file.source_document.file_name}
                                  <Download className="h-3 w-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Sheet {measurement.source_sheet}, row{' '}
                                  {measurement.source_row}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ResizableTableViewport>
              ) : (
                <EmptyState
                  title={resultsQuery.isPending ? 'Loading measurements' : 'No measurements match'}
                  description={resultsQuery.isPending ? 'Retrieving results for the selected filters.' : 'Search by Identifier 1, Identifier 2, species, client, or result file.'}
                />
              )}
            </SectionPanel>

            <SectionPanel
              title="Result files"
              className="xl:col-span-2"
              description={`${filteredResultFiles.length} of ${resultFiles.length} parsed workbooks match the active search.`}
              bodyClassName="p-0"
            >
              {filteredResultFiles.length ? (
                <Table
                  containerClassName="max-w-full"
                  className="min-w-[820px]"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Analysis series</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="sticky right-0 z-20 border-l bg-slate-50 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.5)] dark:bg-slate-900">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResultFiles.map((file) => (
                      <TableRow key={file.id} className="group">
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                            <div className="min-w-0">
                              <p className="max-w-[420px] truncate font-medium">
                                {file.source_document?.file_name ??
                                  file.analysis_series}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatFileSize(
                                  file.source_document?.file_size_bytes ?? 0
                                )}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {file.client?.name ?? 'Unknown client'}
                        </TableCell>
                        <TableCell>{file.analysis_series}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {file.result_date ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {file.row_count.toLocaleString()}
                          <p className="text-[11px] text-muted-foreground">
                            {file.identifier_1_count} IDs · {file.species_count}{' '}
                            species
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusPill
                            tone={
                              file.status === 'parsed'
                                ? 'success'
                                : file.status === 'warning'
                                  ? 'warning'
                                  : 'danger'
                            }
                          >
                            {file.status}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="sticky right-0 z-10 border-l bg-card shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.5)] group-hover:bg-muted/50">
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => exploreFile(file)}
                            >
                              Explore
                            </Button>
                            {file.source_document ? (
                              <Button size="sm" variant="ghost" asChild>
                                <a
                                  href={`/api/client-manager/documents/${file.source_document.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Download className="mr-1 h-3.5 w-3.5" />
                                  File
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title={
                    resultFiles.length
                      ? 'No result files match'
                      : 'No result files yet'
                  }
                  description={
                    resultFiles.length
                      ? 'Clear or change the dependent search filters.'
                      : 'Process the Results folder or upload an Excel workbook.'
                  }
                />
              )}
            </SectionPanel>
          </div>
      )}
    </div>
  );
}
