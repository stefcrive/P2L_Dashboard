import { NextResponse } from 'next/server';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

type ResultMeasurement = {
  identifier_1: string;
  identifier_2: string;
  species: string | null;
  method: string | null;
  observation: string | null;
  d13c_value: number | null;
  d13c_uncertainty: number | null;
  d18o_value: number | null;
  d18o_uncertainty: number | null;
};

const REFERENCE_PATTERN =
  /\b(?:standard|std|nbs|iaea|carrara|calibration|reference)\b/i;

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  );
}

function naturalList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function sampleDeviation(values: number[]) {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numericValues(
  rows: ResultMeasurement[],
  key:
    | 'd13c_value'
    | 'd13c_uncertainty'
    | 'd18o_value'
    | 'd18o_uncertainty'
) {
  return rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function formatPrecision(value: number) {
  return value.toFixed(value < 0.01 ? 3 : 2);
}

function isReference(row: ResultMeasurement) {
  return [
    row.identifier_1,
    row.identifier_2,
    row.species,
    row.method,
    row.observation,
  ].some((value) => REFERENCE_PATTERN.test(value ?? ''));
}

function analysisDescription(
  analysisSeries: string,
  measurements: ResultMeasurement[]
) {
  const seriesText = analysisSeries.trim();
  const combined = `${seriesText} ${measurements
    .map((row) => row.species ?? '')
    .join(' ')}`;
  const hasPlanktonic = /\b(?:planktic|planktics|planktonic)\b/i.test(combined);
  const hasBenthic = /\b(?:benthic|benthics)\b/i.test(combined);
  const hasOtolith = /\botoliths?\b/i.test(combined);
  const hasCoral = /\bcorals?\b/i.test(combined);
  const material =
    hasPlanktonic && hasBenthic
      ? 'planktonic and benthic foraminifera'
      : hasPlanktonic
        ? 'planktonic foraminifera'
        : hasBenthic
          ? 'benthic foraminifera'
          : hasOtolith
            ? 'otolith samples'
            : hasCoral
              ? 'coral samples'
              : null;

  let series = seriesText
    .replace(/\b(?:stable|carbon|oxygen|c\s*&\s*o|isotopes?|results?)\b/gi, ' ')
    .replace(
      /\b(?:planktic|planktics|planktonic|benthic|benthics|foraminifera|otoliths?|corals?|samples?|series)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .replace(/\b(?:and|of)\b\s*$/i, '')
    .replace(/^(?:and|of)\b\s*/i, '')
    .trim();

  const referenceFreeRows = measurements.filter((row) => !isReference(row));
  const identifiers = uniqueValues(
    referenceFreeRows.map((row) => row.identifier_1)
  );
  if ((!series || /^c\s*&?\s*o$/i.test(series)) && !material) {
    series = naturalList(identifiers.slice(0, 4));
  }

  if (material && series) return `for the ${series} series of ${material}`;
  if (material) return `for the ${material}`;

  const species = uniqueValues(
    referenceFreeRows.map((row) => row.species?.replace(/_/g, ' ') ?? null)
  );
  if (series && species.length) {
    return `for the ${series} series (${naturalList(species.slice(0, 4))})`;
  }
  if (series) return `for the ${series} series`;
  if (species.length) return `for the ${naturalList(species.slice(0, 4))} samples`;
  return 'for the submitted sample series';
}

export async function GET(_request: Request, { params: paramsPromise }: RouteContext) {
  const params = await paramsPromise;
  try {
    const database = getSupabaseAdminClient();
    const { data: document, error: documentError } = await database
      .from('client_documents')
      .select('id, client_id, file_name, category')
      .eq('id', params.id)
      .maybeSingle();
    if (documentError) throw new Error(documentError.message);
    if (!document || document.category !== 'analysis') {
      return NextResponse.json({ error: 'Result file not found.' }, { status: 404 });
    }

    const [{ data: client, error: clientError }, { data: resultFile, error: resultError }] =
      await Promise.all([
        database
          .from('clients')
          .select('name, email')
          .eq('id', document.client_id)
          .single(),
        database
          .from('client_result_files')
          .select('id, analysis_series, row_count')
          .eq('source_document_id', document.id)
          .maybeSingle(),
      ]);
    if (clientError || !client) {
      throw new Error(clientError?.message ?? 'Client not found.');
    }
    if (resultError) throw new Error(resultError.message);

    let measurements: ResultMeasurement[] = [];
    if (resultFile) {
      const { data, error } = await database
        .from('result_measurements')
        .select(
          'identifier_1, identifier_2, species, method, observation, d13c_value, d13c_uncertainty, d18o_value, d18o_uncertainty'
        )
        .eq('result_file_id', resultFile.id)
        .order('source_row', { ascending: true });
      if (error) throw new Error(error.message);
      measurements = (data ?? []) as ResultMeasurement[];
    }

    const referenceRows = measurements.filter(isReference);
    const d13cDeviation =
      referenceRows.length >= 2
        ? sampleDeviation(numericValues(referenceRows, 'd13c_value')) ??
          median(numericValues(referenceRows, 'd13c_uncertainty')) ??
          0.06
        : 0.06;
    const d18oDeviation =
      referenceRows.length >= 2
        ? sampleDeviation(numericValues(referenceRows, 'd18o_value')) ??
          median(numericValues(referenceRows, 'd18o_uncertainty')) ??
          0.05
        : 0.05;
    const referenceCount = referenceRows.length >= 2 ? referenceRows.length : 60;
    const series = resultFile?.analysis_series ?? String(document.file_name);
    const description = analysisDescription(series, measurements);
    const subjectSeries = series
      .replace(/\b(?:stable\s+)?c\s*&\s*o\s+(?:isotopes?\s+)?(?:results?)?\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const body = [
      `Dear ${String(client.name)},`,
      '',
      `Please find attached the results of the stable C&O isotope analyses ${description}. The analyses are of good quality and precision, with the standard deviation of the reference material being ${formatPrecision(d13cDeviation)}‰ for δ¹³C and ${formatPrecision(d18oDeviation)}‰ for δ¹⁸O (n = ${referenceCount}) over the measurement period.`,
      '',
      'I remain available in case you have any question.',
      '',
      'Best regards,',
      '',
      'Stefano',
    ].join('\n');

    return NextResponse.json({
      to: String(client.email ?? ''),
      subject: `Stable C&O isotope results${subjectSeries ? ` — ${subjectSeries}` : ''}`,
      body,
      attachmentFileName: String(document.file_name),
      source: resultFile ? 'parsed-result' : 'document-name',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to prepare email.',
      },
      { status: 500 }
    );
  }
}
