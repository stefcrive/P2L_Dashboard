'use client';

import {
  KeyboardEvent,
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
  Check,
  ChevronDown,
  FileSpreadsheet,
  FilterX,
  GripHorizontal,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import {
  Brush,
  CartesianGrid,
  ErrorBar,
  Legend,
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

const speciesColours = [
  '#0f7792',
  '#dd7b16',
  '#3154a5',
  '#118766',
  '#9a4fa3',
];

const speciesLineStyles = ['', '6 3', '2 2', '8 3 2 3', '1 3'];
const plotlyLineStyles = ['solid', 'dash', 'dot', 'dashdot', 'longdash'] as const;

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
    await fetch('/api/results/upload', { method: 'POST', body: formData })
  );
}

async function syncResultsFolder() {
  return readJson(
    await fetch('/api/results/sync', { method: 'POST', cache: 'no-store' })
  );
}

function ResultTooltip({
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
  if (point.isPrecision) {
    return (
      <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
        <p className="font-semibold">Standard measurement precision</p>
        <p className="mt-1 font-mono tabular-nums">
          +/- {formatNumber(point.uncertainty)} per mil on the plotted y-axis
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-72 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{point.species}</p>
      <p className="mt-1 text-muted-foreground">{point.identifier1}</p>
      <p className="text-muted-foreground">Identifier 2: {point.identifier2}</p>
      <p className="mt-2 font-mono text-sm font-semibold tabular-nums">
        {metric === 'carbon' ? 'δ13C' : 'δ18O'} {formatNumber(point.y)} ‰
      </p>
      {point.uncertainty !== null ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          Precision +/- {formatNumber(point.uncertainty)} per mil
        </p>
      ) : null}
    </div>
  );
}

type ChartPoint = {
  x: number;
  y: number;
  uncertainty: number | null;
  identifier1: string;
  identifier2: string;
  species: string;
  isPrecision?: boolean;
};

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

function SearchableDropdown({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  multiple = false,
}: {
  id: string;
  label: string;
  options: FilterOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder: string;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
  const selectedLabel =
    !multiple && selectedValues.length
      ? options.find((option) => option.value === selectedValues[0])?.label ??
        selectedValues[0]
      : '';
  const visibleOptions = options
    .filter((option) =>
      option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function choose(option: FilterOption) {
    if (multiple) {
      const next = selectedValues.includes(option.value)
        ? selectedValues.filter((value) => value !== option.value)
        : [...selectedValues, option.value];
      onChange(next);
      setQuery('');
      setOpen(true);
      return;
    }
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) =>
        Math.min(index + 1, Math.max(visibleOptions.length - 1, 0))
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && visibleOptions[activeIndex]) {
      event.preventDefault();
      choose(visibleOptions[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="block text-xs font-medium">
        {label}
      </label>
      <div className="relative mt-1">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          value={open || multiple ? query : selectedLabel}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!multiple && selectedValues.length) onChange('');
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            multiple && selectedValues.length
              ? `${selectedValues.length} selected`
              : placeholder
          }
          className="pr-16"
        />
        {selectedValues.length ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange(multiple ? [] : '');
              setQuery('');
            }}
            className="absolute right-8 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Clear ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      {open ? (
        <div
          id={`${id}-options`}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {visibleOptions.length ? (
            visibleOptions.map((option, index) => {
              const selected = selectedValues.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs ${
                    index === activeIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center">
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No options match &quot;{query}&quot;.
            </p>
          )}
        </div>
      ) : null}
      {multiple && selectedValues.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedValues.map((selected) => (
            <button
              key={selected}
              type="button"
              onClick={() =>
                onChange(selectedValues.filter((value) => value !== selected))
              }
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-[10px] font-medium"
            >
              <span className="truncate">
                {options.find((option) => option.value === selected)?.label ??
                  selected}
              </span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlotlySequenceChart({
  groups,
  precisionPoint,
  metric,
  showLine,
  showSymbols,
  showPrecision,
  symbolSize,
  xAxisLabels,
  hasSelection,
}: {
  groups: Array<[string, ChartPoint[]]>;
  precisionPoint: ChartPoint | null;
  metric: 'carbon' | 'oxygen';
  showLine: boolean;
  showSymbols: boolean;
  showPrecision: boolean;
  symbolSize: number;
  xAxisLabels: Map<number, string>;
  hasSelection: boolean;
}) {
  const traces: PlotParams['data'] = groups.map(([species, points], index) => ({
    type: 'scatter',
    mode:
      showLine && showSymbols
        ? 'lines+markers'
        : showLine
          ? 'lines'
          : 'markers',
    name: species,
    x: points.map((point) => point.x),
    y: points.map((point) => point.y),
    customdata: points.map((point) => [
      point.identifier1,
      point.identifier2,
      point.uncertainty,
    ]),
    line: {
      color: speciesColours[index % speciesColours.length],
      width: 1.5,
      dash: plotlyLineStyles[index % plotlyLineStyles.length],
    },
    marker: {
      color: speciesColours[index % speciesColours.length],
      size: symbolSize * 2,
      line: { color: '#ffffff', width: 1 },
    },
    hovertemplate:
      '<b>%{fullData.name}</b><br>' +
      '%{customdata[0]}<br>' +
      'Identifier 2: %{customdata[1]}<br>' +
      `${metric === 'carbon' ? 'δ13C' : 'δ18O'}: %{y:.3f} ‰<br>` +
      'Precision: %{customdata[2]:.3f} ‰<extra></extra>',
  }));

  if (showPrecision && precisionPoint) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: precisionPoint.species,
      x: [precisionPoint.x],
      y: [precisionPoint.y],
      marker: { color: '#334155', size: 5 },
      error_y: {
        type: 'data',
        array: [precisionPoint.uncertainty ?? 0],
        visible: true,
        color: '#334155',
        thickness: 1.5,
        width: 5,
      },
      hovertemplate: `${precisionPoint.species}<extra></extra>`,
    });
  }

  const tickEntries = Array.from(xAxisLabels.entries()).sort(
    ([first], [second]) => first - second
  );
  const emptyMessage = hasSelection
    ? 'No plottable measurements match these filters.'
    : 'Select one or more filter items to plot measurements.';

  return (
    <Plot
      data={traces}
      layout={{
        autosize: true,
        height: 450,
        margin: { t: 42, r: 20, b: 72, l: 72 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#64748b', size: 11 },
        hovermode: 'closest',
        showlegend: traces.length > 0,
        legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12 },
        xaxis: {
          title: { text: 'Identifier 2 · sample number or depth' },
          tickmode: 'array',
          tickvals: tickEntries.map(([value]) => value),
          ticktext: tickEntries.map(([, label]) => label),
          gridcolor: '#cbd5e1',
          zeroline: false,
          rangeslider: { visible: traces.length > 0, thickness: 0.08 },
        },
        yaxis: {
          title: { text: `${metric === 'carbon' ? 'δ13C' : 'δ18O'} (‰ VPDB)` },
          gridcolor: '#cbd5e1',
          zerolinecolor: '#94a3b8',
        },
        annotations:
          traces.length === 0
            ? [
                {
                  text: emptyMessage,
                  x: 0.5,
                  y: 0.5,
                  xref: 'paper',
                  yref: 'paper',
                  showarrow: false,
                  font: { color: '#64748b', size: 12 },
                },
              ]
            : [],
      }}
      config={{ responsive: true, displaylogo: false }}
      style={{ width: '100%', height: '450px' }}
      useResizeHandler
    />
  );
}

function BlankSequenceChart({
  metric,
  hasSelection,
}: {
  metric: 'carbon' | 'oxygen';
  hasSelection: boolean;
}) {
  const metricLabel = metric === 'carbon' ? 'δ13C' : 'δ18O';

  return (
    <div
      className="relative h-[450px] w-full"
      aria-label={`Empty ${metricLabel} isotope chart`}
    >
      <div className="absolute bottom-14 left-14 right-4 top-4 overflow-hidden border-b border-l">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '10% 20%',
          }}
        />
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-muted-foreground">
          {hasSelection
            ? 'No plottable measurements match these filters.'
            : 'Select one or more filter items to plot measurements.'}
        </p>
      </div>
      <p className="absolute bottom-4 left-14 right-4 text-center text-[11px] text-muted-foreground">
        Identifier 2 · sample number or depth
      </p>
      <p className="absolute bottom-14 left-0 top-4 grid w-10 place-items-center text-[11px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">
        {metricLabel} (‰ VPDB)
      </p>
    </div>
  );
}

function ResizableTableViewport({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(520);
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
        Math.max(260, dragStart.current.height + event.clientY - dragStart.current.y)
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
      <div className="overflow-auto" style={{ height }}>
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

export function ResultsDashboard() {
  const queryClient = useQueryClient();
  const sourceDocumentLinkHandled = useRef(false);
  const [linkedSourceDocumentId, setLinkedSourceDocumentId] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState('');
  const [metric, setMetric] = useState<'carbon' | 'oxygen'>('carbon');
  const [usePlotly, setUsePlotly] = useState(false);
  const [corrected, setCorrected] = useState(true);
  const [showLine, setShowLine] = useState(true);
  const [showSymbols, setShowSymbols] = useState(true);
  const [showPrecision, setShowPrecision] = useState(true);
  const [symbolSize, setSymbolSize] = useState(5);
  const [zoomRange, setZoomRange] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);

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
        queryClient.invalidateQueries({ queryKey: ['result-register-options'] }),
        queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
        queryClient.invalidateQueries({ queryKey: ['operations-header-summary'] }),
      ]);
    },
    onError: (error: Error) => setStatus(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: syncResultsFolder,
    onSuccess: async (payload) => {
      const issueCount = (payload.errors?.length ?? 0) + (payload.warnings?.length ?? 0);
      setStatus(
        `${payload.totalFiles} files checked, ${payload.importedFiles} imported, ${payload.skippedFiles} unchanged${issueCount ? `, ${issueCount} notices` : ''}.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['result-register'] }),
        queryClient.invalidateQueries({ queryKey: ['result-register-options'] }),
        queryClient.invalidateQueries({ queryKey: ['client-manager'] }),
      ]);
    },
    onError: (error: Error) => setStatus(error.message),
  });

  const data = resultsQuery.data;
  const resultFiles = useMemo(() => data?.resultFiles ?? [], [data?.resultFiles]);
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
      new URLSearchParams(window.location.search).get('sourceDocumentId')?.trim() ??
        ''
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
        optionRows.filter((row) =>
          rowMatchesFilters(row, filters, 'clientId')
        ),
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
        optionRows.filter((row) =>
          rowMatchesFilters(row, filters, 'species')
        ),
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
        (!filters.clientId.length || filters.clientId.includes(file.client_id)) &&
        (!filters.resultFileId.length || filters.resultFileId.includes(file.id)) &&
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
    const sequenceValues = Array.from(
      new Set(sorted.map((measurement) => measurement.identifier_2))
    );
    const sequenceIndex = new Map(
      sequenceValues.map((identifier, index) => [identifier, index + 1])
    );
    const groups = new Map<string, ChartPoint[]>();
    sorted.forEach((measurement) => {
      const rawValue =
        metric === 'carbon'
          ? measurement.d13c_value
          : measurement.d18o_value;
      const correctedValue =
        metric === 'carbon'
          ? measurement.corrected_d13c
          : measurement.corrected_d18o;
      const uncertainty =
        metric === 'carbon'
          ? measurement.d13c_uncertainty
          : measurement.d18o_uncertainty;
      const value = corrected ? correctedValue ?? rawValue : rawValue;
      if (value === null) return;
      const species = measurement.species || 'Unspecified species';
      const points = groups.get(species) ?? [];
      points.push({
        x: sequenceIndex.get(measurement.identifier_2) ?? points.length + 1,
        y: Number(value),
        uncertainty:
          uncertainty === null ? null : Math.abs(Number(uncertainty)),
        identifier1: measurement.identifier_1,
        identifier2: measurement.identifier_2,
        species,
      });
      groups.set(species, points);
    });
    return Array.from(groups.entries());
  }, [corrected, measurements, metric]);

  const chartPoints = useMemo(
    () => chartGroups.flatMap(([, points]) => points),
    [chartGroups]
  );

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
    const xValues = chartPoints.map((point) => point.x);
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
      isPrecision: true,
    } satisfies ChartPoint;
  }, [chartPoints, measurements, metric]);

  const xAxisLabels = useMemo(() => {
    const labels = new Map<number, string>();
    chartGroups.forEach(([, points]) =>
      points.forEach((point) => labels.set(point.x, point.identifier2))
    );
    return labels;
  }, [chartGroups]);

  const zoomData = useMemo(
    () =>
      Array.from(xAxisLabels, ([x, label]) => ({ x, label })).sort(
        (first, second) => first.x - second.x
      ),
    [xAxisLabels]
  );
  const visibleXRange = useMemo(() => {
    if (!zoomData.length) return null;
    const start =
      zoomRange?.startIndex === undefined
        ? 0
        : Math.min(zoomRange.startIndex, zoomData.length - 1);
    const end =
      zoomRange?.endIndex === undefined
        ? zoomData.length - 1
        : Math.min(zoomRange.endIndex, zoomData.length - 1);
    return [zoomData[start].x, zoomData[end].x] as const;
  }, [zoomData, zoomRange]);
  const visibleChartGroups = useMemo(
    () =>
      visibleXRange
        ? chartGroups.map(([species, points]) => [
            species,
            points.filter(
              (point) =>
                point.x >= visibleXRange[0] && point.x <= visibleXRange[1]
            ),
          ] as [string, ChartPoint[]])
        : chartGroups,
    [chartGroups, visibleXRange]
  );
  const displayPrecisionPoint = useMemo(
    () =>
      precisionPoint && visibleXRange
        ? { ...precisionPoint, x: visibleXRange[0] }
        : precisionPoint,
    [precisionPoint, visibleXRange]
  );

  useEffect(() => {
    setZoomRange(null);
  }, [
    filters.clientId,
    filters.resultFileId,
    filters.identifier1,
    filters.identifier2,
    filters.species,
  ]);

  function clearSearch() {
    setFilters({
      identifier1: [],
      identifier2: [],
      species: [],
      clientId: [],
      resultFileId: [],
    });
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
    <div className="space-y-5">
      <PageHeader
        title="Results register"
        description="Import stable carbon and oxygen isotope workbooks, find measurements by record identifiers and species, and inspect analytical sequences."
        actions={
          <Button
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
            />
            Process Results folder
          </Button>
        }
      />

      <Toolbar className="space-y-3">
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
            {uploadMutation.isPending ? 'Parsing workbook…' : 'Upload and import'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            The filename is used to match or create the client; the original workbook is retained as a result document.
          </span>
          {status ? (
            <span aria-live="polite" className="font-medium text-foreground">
              {status}
            </span>
          ) : null}
        </div>
      </Toolbar>

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
        <>
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <SectionPanel
              title="Search results"
              description="Select one or more items in any field; each choice narrows the available options."
            >
              <div className="space-y-3">
                <SearchableDropdown
                  id="result-client-filter"
                  label="Client"
                  options={clientOptions}
                  value={filters.clientId}
                  multiple
                  onChange={(value) =>
                    setFilters({
                      ...emptyFilters,
                      clientId: value as string[],
                    })
                  }
                  placeholder={
                    optionsQuery.isLoading ? 'Loading clients…' : 'All clients'
                  }
                />
                <SearchableDropdown
                  id="result-file-filter"
                  label="Result file"
                  options={fileOptions}
                  value={filters.resultFileId}
                  multiple
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      resultFileId: value as string[],
                      species: [],
                      identifier1: [],
                      identifier2: [],
                    }))
                  }
                  placeholder="Select one or more result files"
                />
                <SearchableDropdown
                  id="result-species-filter"
                  label="Species"
                  options={speciesOptions}
                  value={filters.species}
                  multiple
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      species: value as string[],
                      identifier1: [],
                      identifier2: [],
                    }))
                  }
                  placeholder="Select one or more species"
                />
                <SearchableDropdown
                  id="result-identifier-1-filter"
                  label="Identifier 1"
                  options={identifier1Options}
                  value={filters.identifier1}
                  multiple
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      identifier1: value as string[],
                      identifier2: [],
                    }))
                  }
                  placeholder="Sediment core or record ID"
                />
                <SearchableDropdown
                  id="result-identifier-2-filter"
                  label="Identifier 2"
                  options={identifier2Options}
                  value={filters.identifier2}
                  multiple
                  onChange={(value) =>
                    setFilters((current) => ({
                      ...current,
                      identifier2: value as string[],
                    }))
                  }
                  placeholder="Sample number or depth"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={clearSearch}
                >
                  <FilterX className="mr-1.5 h-4 w-4" />
                  Clear all filters
                </Button>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {data?.measurementCount ?? 0} measurements match.
                  {data?.truncated
                    ? ' Refine the fields to narrow the 1,000-row preview.'
                    : ''}
                </p>
              </div>
            </SectionPanel>

            <SectionPanel
              title="Isotope sequence"
              description="Line and symbols follow Identifier 2; colour and stroke pattern separate species. Drag the lower navigator to zoom."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={usePlotly}
                      onChange={(event) => setUsePlotly(event.target.checked)}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Plotly chart
                  </label>
                  <div className="flex rounded-md border bg-muted/30 p-0.5">
                    <Button
                      size="sm"
                      variant={metric === 'carbon' ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setMetric('carbon')}
                    >
                      δ13C
                    </Button>
                    <Button
                      size="sm"
                      variant={metric === 'oxygen' ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setMetric('oxygen')}
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
                      onChange={(event) => setSymbolSize(Number(event.target.value))}
                      className={`${selectClassName} h-7 w-16 py-0 text-[11px]`}
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
                      onChange={(event) => setShowPrecision(event.target.checked)}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Standard precision
                  </label>
                </div>
              }
            >
              {usePlotly ? (
                <PlotlySequenceChart
                  groups={hasChartSelection ? visibleChartGroups : []}
                  precisionPoint={
                    hasChartSelection ? displayPrecisionPoint : null
                  }
                  metric={metric}
                  showLine={showLine}
                  showSymbols={showSymbols}
                  showPrecision={showPrecision}
                  symbolSize={symbolSize}
                  xAxisLabels={hasChartSelection ? xAxisLabels : new Map()}
                  hasSelection={hasChartSelection}
                />
              ) : hasChartSelection && chartGroups.length ? (
                <div className="h-[450px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart
                      data={zoomData}
                      margin={{ top: 8, right: 12, bottom: 54, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.32} />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Identifier 2"
                        domain={
                          visibleXRange
                            ? [visibleXRange[0], visibleXRange[1]]
                            : ['dataMin', 'dataMax']
                        }
                        allowDataOverflow
                        tick={{ fontSize: 10 }}
                        tickFormatter={(value) =>
                          xAxisLabels.get(Number(value)) ?? ''
                        }
                        label={{
                          value: 'Identifier 2 · sample number or depth',
                          position: 'insideBottom',
                          offset: -20,
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name={metric === 'carbon' ? 'δ13C' : 'δ18O'}
                        unit=" ‰"
                        tick={{ fontSize: 10 }}
                        width={70}
                        label={{
                          value: `${metric === 'carbon' ? 'δ13C' : 'δ18O'} (‰ VPDB)`,
                          angle: -90,
                          position: 'insideLeft',
                          fontSize: 11,
                        }}
                      />
                      <Tooltip
                        content={<ResultTooltip metric={metric} />}
                        cursor={{ strokeDasharray: '3 3' }}
                      />
                      <Legend
                        verticalAlign="top"
                        align="right"
                        wrapperStyle={{ fontSize: 11, paddingBottom: 12 }}
                      />
                      {visibleChartGroups.map(([species, points], index) => (
                        <Scatter
                          key={species}
                          name={species}
                          data={points}
                          fill={speciesColours[index % speciesColours.length]}
                          line={
                            showLine
                              ? {
                                  stroke:
                                    speciesColours[
                                      index % speciesColours.length
                                    ],
                                  strokeWidth: 1.5,
                                  strokeDasharray:
                                    speciesLineStyles[
                                      index % speciesLineStyles.length
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
                      ))}
                      {showPrecision && displayPrecisionPoint ? (
                        <Scatter
                          name={displayPrecisionPoint.species}
                          data={[displayPrecisionPoint]}
                          fill="#334155"
                          legendType="line"
                          shape={(shapeProps: unknown) => {
                            const point = shapeProps as {
                              cx?: number;
                              cy?: number;
                            };
                            return point.cx !== undefined &&
                              point.cy !== undefined ? (
                              <circle
                                cx={point.cx}
                                cy={point.cy}
                                r={2.5}
                                fill="#334155"
                              />
                            ) : (
                              <g />
                            );
                          }}
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
                      <Brush
                        data={zoomData}
                        dataKey="x"
                        height={24}
                        stroke="#64748b"
                        travellerWidth={8}
                        startIndex={zoomRange?.startIndex}
                        endIndex={zoomRange?.endIndex}
                        onChange={(range) => {
                          if (
                            range.startIndex !== undefined &&
                            range.endIndex !== undefined
                          ) {
                            setZoomRange({
                              startIndex: range.startIndex,
                              endIndex: range.endIndex,
                            });
                          }
                        }}
                        tickFormatter={(value) =>
                          xAxisLabels.get(Number(value)) ?? ''
                        }
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <BlankSequenceChart
                  metric={metric}
                  hasSelection={hasChartSelection}
                />
              )}
            </SectionPanel>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-2">
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
                                ? measurement.corrected_d13c ??
                                    measurement.d13c_value
                                : measurement.d13c_value
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumber(
                              corrected
                                ? measurement.corrected_d18o ??
                                    measurement.d18o_value
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
                title="No measurements match"
                description="Search by Identifier 1, Identifier 2, species, client, or result file."
              />
            )}
            </SectionPanel>

            <SectionPanel
              title="Result files"
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
                        <TableCell>{file.client?.name ?? 'Unknown client'}</TableCell>
                        <TableCell>{file.analysis_series}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {file.result_date ?? '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {file.row_count.toLocaleString()}
                          <p className="text-[10px] text-muted-foreground">
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
        </>
      )}
    </div>
  );
}
