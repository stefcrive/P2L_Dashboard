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
  identifier1: string;
  identifier2: string;
  species: string[];
  clientId: string;
  resultFileId: string;
};

const emptyFilters: SearchFilters = {
  identifier1: '',
  identifier2: '',
  species: [],
  clientId: '',
  resultFileId: '',
};

const speciesColours = [
  '#0f7792',
  '#dd7b16',
  '#3154a5',
  '#118766',
  '#9a4fa3',
];

const speciesLineStyles = ['', '6 3', '2 2', '8 3 2 3', '1 3'];

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
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (value.trim()) {
      params.set(key, value.trim());
    }
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
  return (
    <div className="max-w-72 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{point.species}</p>
      <p className="mt-1 text-muted-foreground">{point.identifier1}</p>
      <p className="text-muted-foreground">Identifier 2: {point.identifier2}</p>
      <p className="mt-2 font-mono text-sm font-semibold tabular-nums">
        {metric === 'carbon' ? 'δ13C' : 'δ18O'} {formatNumber(point.y)} ‰
      </p>
    </div>
  );
}

type ChartPoint = {
  x: number;
  y: number;
  identifier1: string;
  identifier2: string;
  species: string;
};

export function ResultsDashboard() {
  const queryClient = useQueryClient();
  const initialSelectionMade = useRef(false);
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(emptyFilters);
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState('');
  const [metric, setMetric] = useState<'carbon' | 'oxygen'>('carbon');
  const [corrected, setCorrected] = useState(true);

  const resultsQuery = useQuery({
    queryKey: ['result-register', filters],
    queryFn: () => fetchResults(filters),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadResultFile,
    onSuccess: async (payload) => {
      setStatus(payload.message);
      setUploadFile(null);
      setFileInputKey((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['result-register'] }),
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

  useEffect(() => {
    if (
      initialSelectionMade.current ||
      resultFiles.length === 0 ||
      filters.resultFileId
    ) {
      return;
    }
    initialSelectionMade.current = true;
    const nextFilters = {
      ...emptyFilters,
      resultFileId: resultFiles[0].id,
    };
    setDraftFilters(nextFilters);
    setFilters(nextFilters);
  }, [filters.resultFileId, resultFiles]);

  const clients = useMemo(() => {
    const byId = new Map<string, Client>();
    resultFiles.forEach((file) => {
      if (file.client) byId.set(file.client.id, file.client);
    });
    return Array.from(byId.values()).sort((first, second) =>
      first.name.localeCompare(second.name)
    );
  }, [resultFiles]);

  const fileById = useMemo(
    () => new Map(resultFiles.map((file) => [file.id, file])),
    [resultFiles]
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
    const groups = new Map<string, ChartPoint[]>();
    sorted.forEach((measurement, index) => {
      const rawValue =
        metric === 'carbon'
          ? measurement.d13c_value
          : measurement.d18o_value;
      const correctedValue =
        metric === 'carbon'
          ? measurement.corrected_d13c
          : measurement.corrected_d18o;
      const value = corrected ? correctedValue ?? rawValue : rawValue;
      if (value === null) return;
      const species = measurement.species || 'Unspecified species';
      const points = groups.get(species) ?? [];
      points.push({
        x: index + 1,
        y: Number(value),
        identifier1: measurement.identifier_1,
        identifier2: measurement.identifier_2,
        species,
      });
      groups.set(species, points);
    });
    return Array.from(groups.entries());
  }, [corrected, measurements, metric]);

  const xAxisLabels = useMemo(() => {
    const labels = new Map<number, string>();
    chartGroups.forEach(([, points]) =>
      points.forEach((point) => labels.set(point.x, point.identifier2))
    );
    return labels;
  }, [chartGroups]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setFilters(draftFilters);
  }

  function clearSearch() {
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
    initialSelectionMade.current = true;
  }

  function exploreFile(file: ResultFile) {
    const nextFilters = {
      ...emptyFilters,
      resultFileId: file.id,
      clientId: file.client_id,
    };
    setDraftFilters(nextFilters);
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

      {resultsQuery.isError ? (
        <EmptyState
          error
          title="The result register could not be loaded"
          description={(resultsQuery.error as Error).message}
        />
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <SectionPanel
              title="Record results"
              description="Search the scientific fields stored in each workbook."
            >
              <form className="space-y-3" onSubmit={submitSearch}>
                <label className="block text-xs font-medium">
                  Identifier 1
                  <Input
                    value={draftFilters.identifier1}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        identifier1: event.target.value,
                      }))
                    }
                    placeholder="Sediment core or record ID"
                    className="mt-1"
                  />
                </label>
                <label className="block text-xs font-medium">
                  Identifier 2
                  <Input
                    value={draftFilters.identifier2}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        identifier2: event.target.value,
                      }))
                    }
                    placeholder="Sample number or depth"
                    className="mt-1"
                  />
                </label>
                <label className="block text-xs font-medium">
                  Species
                  <Input
                    value={draftFilters.species}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        species: event.target.value,
                      }))
                    }
                    placeholder="e.g. C. wuellerstorfi"
                    className="mt-1"
                  />
                </label>
                <label className="block text-xs font-medium">
                  Client
                  <select
                    value={draftFilters.clientId}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        clientId: event.target.value,
                        resultFileId: '',
                      }))
                    }
                    className={`${selectClassName} mt-1`}
                  >
                    <option value="">All clients</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  Result file
                  <select
                    value={draftFilters.resultFileId}
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        resultFileId: event.target.value,
                      }))
                    }
                    className={`${selectClassName} mt-1`}
                  >
                    <option value="">All result files</option>
                    {resultFiles
                      .filter(
                        (file) =>
                          !draftFilters.clientId ||
                          file.client_id === draftFilters.clientId
                      )
                      .map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.source_document?.file_name ?? file.analysis_series}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button type="submit" disabled={resultsQuery.isFetching}>
                    <Search className="mr-1.5 h-4 w-4" />
                    Search
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearSearch}
                  >
                    <FilterX className="mr-1.5 h-4 w-4" />
                    Clear
                  </Button>
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {data?.measurementCount ?? 0} measurements match.
                  {data?.truncated
                    ? ' Refine the fields to narrow the 1,000-row preview.'
                    : ''}
                </p>
              </form>
            </SectionPanel>

            <SectionPanel
              title="Isotope sequence"
              description="Identifier 2 defines the sequence; colour separates species."
              actions={
                <div className="flex flex-wrap items-center gap-2">
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
                </div>
              }
            >
              {chartGroups.length ? (
                <div className="h-[390px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart
                      margin={{ top: 8, right: 12, bottom: 32, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.32} />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="Identifier 2"
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
                      {chartGroups.map(([species, points], index) => (
                        <Scatter
                          key={species}
                          name={species}
                          data={points}
                          fill={speciesColours[index % speciesColours.length]}
                          line={false}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  title="No plottable measurements"
                  description="Choose a result file or adjust the scientific search fields."
                />
              )}
            </SectionPanel>
          </div>

          <SectionPanel
            title="Measurement results"
            description={`${Math.min(measurements.length, 300)} rows shown with source-file provenance.`}
            bodyClassName="p-0"
          >
            {measurements.length ? (
              <div className="max-h-[520px] overflow-auto">
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
              </div>
            ) : (
              <EmptyState
                title="No measurements match"
                description="Search by Identifier 1, Identifier 2, species, client, or result file."
              />
            )}
          </SectionPanel>

          <SectionPanel
            title="Result files"
            description={`${resultFiles.length} parsed workbooks are linked to client records.`}
            bodyClassName="p-0"
          >
            {resultFiles.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Analysis series</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultFiles.map((file) => (
                      <TableRow key={file.id}>
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
                        <TableCell>
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
              </div>
            ) : (
              <EmptyState
                title="No result files yet"
                description="Process the Results folder or upload an Excel workbook."
              />
            )}
          </SectionPanel>
        </>
      )}
    </div>
  );
}
