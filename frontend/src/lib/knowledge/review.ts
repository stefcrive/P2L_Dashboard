import 'server-only';
import { hydrateKnowledgePath } from '@/lib/cloud/knowledge-files';

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { assertPathInsideRepository, getKnowledgeConfig } from './config';
import { getKnowledgeDatabase } from './db';
import { autoTriageReviewBatch, type AutoTriageResult } from './openai';
import { parseMergedConversation } from './parser';
import type { EnrichmentResult, ParsedMessage } from './types';

export type ReviewStatus = 'pending' | 'kept' | 'quarantined' | 'skipped';
export type AutoTriageFilter =
  | 'untriaged'
  | 'assessed'
  | 'kept'
  | 'quarantined'
  | 'needs_review';

const TECHNICAL_PATTERN =
  /\b(?:irms|mass spectrom(?:eter|etry)|isotope|isotopic|chromatograph|elemental analy[sz]er|sample|standard|reference gas|calibrat|normaliz|blank correction|linearity|peak|baseline|reactor|combustion|pyrolysis|capillar|column|autosampler|collector|faraday|filament|vacuum|pump|helium|carrier gas|flow rate|leak|fault|error|signal|voltage|pressure|temperature|software|firmware|method|protocol|measurement|precision|accuracy|reproducib|repair|replace|troubleshoot|gasket|gas\s*bench|delta\s+(?:xl|v|plus|xp|s)|duo\s*\d|tcea|conflo|isoprime|mat\s*25[123]|brf5)\b/gi;
const QUANTITATIVE_PATTERN =
  /(?:\b\d+(?:\.\d+)?\s*(?:ppm|ppb|ppt|mbar|bar|psi|kpa|pa|ml\/min|l\/min|sccm|mv|kv|v|ma|a|hz|khz|mhz|°c|deg(?:rees)?\s*c|µm|um|mm|cm)\b|\bm\/z\s*\d+|(?:δ|d)\s*\d{1,2}[A-Za-z]{1,2}\b)/gi;
const ADMINISTRATIVE_SUBJECT_PATTERN =
  /\b(?:job|vacanc|position available|postdoc|post-doc|studentship|faculty|tenure[- ]track|conference|congress|work\s*shop|meeting|webinar|symposium|seminar|unsubscribe|automatic reply|out of (?:the )?office|for sale|used instrument)\b/i;

interface ReviewSignals {
  technicalTerms: number;
  quantitativeTerms: number;
  enrichmentRelevance: EnrichmentResult['relevance'] | null;
  parserWarnings: number;
}

interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface ReviewCandidate {
  messageId: number | null;
  sourceId: number | null;
  sourcePath: string;
  sourceName: string;
  sourceOrdinal: number;
  rawSourcePath: string | null;
  rawStartLine: number | null;
  rawEndLine: number | null;
  stableId: string;
  threadKey: string;
  subject: string;
  author: string;
  messageDate: string | null;
  content: string;
  contentFingerprint: string;
  origin: 'ingestion' | 'cleanup_audit';
  initialStatus?: ReviewStatus;
  reasonCodes: string[];
  signals: Record<string, unknown>;
}

function matchCount(value: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  const count = value.match(pattern)?.length ?? 0;
  pattern.lastIndex = 0;
  return count;
}

export function reviewFingerprint(subject: string, content: string) {
  return createHash('sha256')
    .update(`${subject.trim().toLowerCase()}\n${content.trim()}`)
    .digest('hex');
}

export function assessReviewCandidate(
  message: ParsedMessage,
  enrichment?: EnrichmentResult
) {
  const text = `${message.subjectNormalized}\n${message.cleanText}`;
  const signals: ReviewSignals = {
    technicalTerms: matchCount(text, TECHNICAL_PATTERN),
    quantitativeTerms: matchCount(text, QUANTITATIVE_PATTERN),
    enrichmentRelevance: enrichment?.relevance ?? null,
    parserWarnings: message.warnings.length,
  };
  if (message.deterministicMetadata.visualAsset) {
    return { needsReview: false, reasons: [], signals };
  }
  const reasons: string[] = [];
  if (!message.cleanText.trim()) reasons.push('empty_content');
  if (ADMINISTRATIVE_SUBJECT_PATTERN.test(message.subjectNormalized)) {
    reasons.push('administrative_genre');
  }
  if (enrichment && enrichment.relevance !== 'technical') {
    reasons.push(`enrichment_${enrichment.relevance}`);
  }
  if (
    signals.technicalTerms < 2 &&
    signals.quantitativeTerms === 0 &&
    enrichment?.relevance !== 'technical'
  ) {
    reasons.push('uncertain_relevance');
  }
  if (message.warnings.length) reasons.push('parser_warning');
  return {
    needsReview: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
    signals,
  };
}

export async function getQuarantinedOrdinals(
  sourcePath: string,
  messages: ParsedMessage[]
) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{
    source_ordinal: number;
    content_fingerprint: string;
  }>(
    `SELECT source_ordinal, content_fingerprint
     FROM kb.review_items
     WHERE source_path = $1 AND status = 'quarantined'`,
    [sourcePath]
  );
  const fingerprints = new Map(
    result.rows.map((row) => [
      Number(row.source_ordinal),
      row.content_fingerprint,
    ])
  );
  return new Set(
    messages.flatMap((message) => {
      const expected = fingerprints.get(message.sourceOrdinal);
      if (
        expected &&
        expected ===
          reviewFingerprint(message.subjectNormalized, message.cleanText)
      ) {
        return [message.sourceOrdinal];
      }
      return [];
    })
  );
}

export async function upsertReviewCandidate(
  database: Queryable,
  candidate: ReviewCandidate
) {
  await database.query(
    `INSERT INTO kb.review_items (
       message_id, source_id, source_path, source_name, source_ordinal,
       raw_source_path, raw_start_line, raw_end_line, stable_id, thread_key,
       subject, author, message_date, content, content_fingerprint, origin,
       status, reason_codes, signals
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13::timestamptz, $14, $15, $16, $17, $18::jsonb, $19::jsonb
     )
     ON CONFLICT (source_path, source_ordinal, content_fingerprint)
     DO UPDATE SET
       message_id = excluded.message_id,
       source_id = excluded.source_id,
       stable_id = excluded.stable_id,
       thread_key = excluded.thread_key,
       subject = excluded.subject,
       author = excluded.author,
       message_date = excluded.message_date,
       content = excluded.content,
       reason_codes = excluded.reason_codes,
       signals = kb.review_items.signals || excluded.signals,
       updated_at = now()`,
    [
      candidate.messageId,
      candidate.sourceId,
      candidate.sourcePath,
      candidate.sourceName,
      candidate.sourceOrdinal,
      candidate.rawSourcePath,
      candidate.rawStartLine,
      candidate.rawEndLine,
      candidate.stableId,
      candidate.threadKey,
      candidate.subject,
      candidate.author,
      candidate.messageDate,
      candidate.content,
      candidate.contentFingerprint,
      candidate.origin,
      candidate.initialStatus ?? 'pending',
      JSON.stringify(candidate.reasonCodes),
      JSON.stringify(candidate.signals),
    ]
  );
}

export async function createIngestionReviewCandidate(params: {
  database: Queryable;
  message: ParsedMessage;
  messageId: number;
  sourceId: number;
  sourcePath: string;
  sourceName: string;
  enrichment?: EnrichmentResult;
}) {
  const assessment = assessReviewCandidate(params.message, params.enrichment);
  if (!assessment.needsReview) return false;
  await upsertReviewCandidate(params.database, {
    messageId: params.messageId,
    sourceId: params.sourceId,
    sourcePath: params.sourcePath,
    sourceName: params.sourceName,
    sourceOrdinal: params.message.sourceOrdinal,
    rawSourcePath: null,
    rawStartLine: params.message.startLine,
    rawEndLine: params.message.endLine,
    stableId: params.message.stableId,
    threadKey: params.message.threadKey,
    subject: params.message.subjectNormalized,
    author: params.message.authorDisplay,
    messageDate: params.message.dateIso,
    content: params.message.cleanText,
    contentFingerprint: reviewFingerprint(
      params.message.subjectNormalized,
      params.message.cleanText
    ),
    origin: 'ingestion',
    reasonCodes: assessment.reasons,
    signals: { ...assessment.signals },
  });
  return true;
}

export async function stageIngestionReviewCandidates(params: {
  database: Queryable;
  messages: ParsedMessage[];
  sourcePath: string;
  sourceName: string;
  enrichments: Map<string, EnrichmentResult>;
}) {
  let pending = 0;
  for (const message of params.messages) {
    const enrichment = params.enrichments.get(message.stableId);
    const assessment = assessReviewCandidate(message, enrichment);
    if (!assessment.needsReview) continue;
    const fingerprint = reviewFingerprint(
      message.subjectNormalized,
      message.cleanText
    );
    await upsertReviewCandidate(params.database, {
      messageId: null,
      sourceId: null,
      sourcePath: params.sourcePath,
      sourceName: params.sourceName,
      sourceOrdinal: message.sourceOrdinal,
      rawSourcePath: null,
      rawStartLine: message.startLine,
      rawEndLine: message.endLine,
      stableId: message.stableId,
      threadKey: message.threadKey,
      subject: message.subjectNormalized,
      author: message.authorDisplay,
      messageDate: message.dateIso,
      content: message.cleanText,
      contentFingerprint: fingerprint,
      origin: 'ingestion',
      reasonCodes: assessment.reasons,
      signals: { ...assessment.signals },
    });
    const current = await params.database.query<{ status: ReviewStatus }>(
      `SELECT status FROM kb.review_items
       WHERE source_path = $1 AND source_ordinal = $2
         AND content_fingerprint = $3`,
      [params.sourcePath, message.sourceOrdinal, fingerprint]
    );
    if (current.rows[0]?.status === 'pending') pending += 1;
  }
  return pending;
}

export async function getReviewQueue(options: {
  status?: ReviewStatus | 'all';
  search?: string;
  reason?: string;
  autoState?: AutoTriageFilter;
  jobId?: number;
  limit?: number;
  offset?: number;
}) {
  const database = await getKnowledgeDatabase();
  const status = options.status ?? 'pending';
  const search = options.search?.trim() ?? '';
  const reason = options.reason?.trim() ?? '';
  const autoState = options.autoState;
  const limit = Math.min(50, Math.max(1, Number(options.limit ?? 25)));
  const offset = Math.max(0, Number(options.offset ?? 0));
  const filters: string[] = [];
  const params: unknown[] = [];
  if (status !== 'all') {
    params.push(status);
    filters.push(`r.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    filters.push(
      `(r.subject ILIKE $${params.length} OR r.content ILIKE $${params.length} OR r.source_name ILIKE $${params.length})`
    );
  }
  if (reason) {
    params.push(JSON.stringify([reason]));
    filters.push(`r.reason_codes @> $${params.length}::jsonb`);
  }
  if (autoState === 'kept' || autoState === 'quarantined') {
    params.push(autoState);
    filters.push(
      `r.signals ->> 'decisionSource' = 'model' AND r.signals -> 'autoTriage' ->> 'appliedStatus' = $${params.length}`
    );
  } else if (autoState === 'assessed') {
    filters.push(`r.signals ? 'autoTriage'`);
  } else if (autoState === 'needs_review') {
    filters.push(`r.status = 'pending' AND r.signals ? 'autoTriage'`);
  } else if (autoState === 'untriaged') {
    filters.push(`r.status = 'pending' AND NOT (r.signals ? 'autoTriage')`);
  }
  if (Number.isSafeInteger(options.jobId) && Number(options.jobId) > 0) {
    params.push(Number(options.jobId));
    filters.push(
      `EXISTS (
         SELECT 1 FROM kb.job_files jf
         WHERE jf.job_id = $${params.length}
           AND (jf.source_path = r.source_path OR jf.source_name = r.source_name)
       )`
    );
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit, offset);
  const items = await database.query<Record<string, unknown>>(
    `SELECT r.id::text, r.message_id::text, r.source_id::text,
            r.source_path, r.source_name, r.source_ordinal,
            r.raw_source_path, r.raw_start_line, r.raw_end_line,
            r.stable_id, r.thread_key, r.subject, r.author, r.message_date,
            r.content, r.origin, r.status, r.reason_codes, r.signals,
            r.reviewer_note, r.reviewed_at, r.created_at, r.updated_at,
            count(*) OVER ()::integer AS filtered_total
     FROM kb.review_items r
     ${where}
     ORDER BY
       CASE r.status
         WHEN 'pending' THEN 0
         WHEN 'skipped' THEN 1
         WHEN 'kept' THEN 2
         ELSE 3
       END,
       CASE
         WHEN r.reason_codes @> '["empty_after_cleanup"]'::jsonb THEN 0
         WHEN r.reason_codes @> '["commercial_posting"]'::jsonb THEN 1
         WHEN r.reason_codes @> '["event_announcement"]'::jsonb THEN 2
         WHEN r.reason_codes @> '["job_posting"]'::jsonb THEN 3
         WHEN r.reason_codes @> '["list_administration"]'::jsonb THEN 4
         WHEN r.reason_codes @> '["nontechnical_conversation"]'::jsonb THEN 5
         WHEN r.reason_codes @> '["ambiguous_retained_for_recall"]'::jsonb THEN 6
         ELSE 7
       END,
       r.updated_at DESC, r.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const populationParams =
    Number.isSafeInteger(options.jobId) && Number(options.jobId) > 0
      ? [Number(options.jobId)]
      : [];
  const populationWhere = populationParams.length
    ? `WHERE EXISTS (
         SELECT 1 FROM kb.job_files jf
         WHERE jf.job_id = $1
           AND (
             jf.source_path = kb.review_items.source_path
             OR jf.source_name = kb.review_items.source_name
           )
       )`
    : '';
  const stats = await database.query<{
    total: number;
    pending: number;
    kept: number;
    quarantined: number;
    skipped: number;
    human_reviewed: number;
    cleanup_audit: number;
    ingestion: number;
    auto_triaged: number;
    auto_kept: number;
    auto_quarantined: number;
    auto_needs_review: number;
    auto_untriaged: number;
  }>(
    `SELECT
       count(*)::integer AS total,
       count(*) FILTER (WHERE status = 'pending')::integer AS pending,
       count(*) FILTER (WHERE status = 'kept')::integer AS kept,
       count(*) FILTER (WHERE status = 'quarantined')::integer AS quarantined,
       count(*) FILTER (WHERE status = 'skipped')::integer AS skipped,
       count(*) FILTER (
         WHERE reviewed_at IS NOT NULL
           AND (
             signals ->> 'decisionSource' = 'human'
             OR NOT (signals ? 'autoTriage')
           )
       )::integer AS human_reviewed,
       count(*) FILTER (WHERE origin = 'cleanup_audit')::integer AS cleanup_audit,
       count(*) FILTER (WHERE origin = 'ingestion')::integer AS ingestion,
       count(*) FILTER (WHERE signals ? 'autoTriage')::integer AS auto_triaged,
       count(*) FILTER (
         WHERE signals ->> 'decisionSource' = 'model' AND status = 'kept'
       )::integer AS auto_kept,
       count(*) FILTER (
         WHERE signals ->> 'decisionSource' = 'model' AND status = 'quarantined'
       )::integer AS auto_quarantined,
       count(*) FILTER (
         WHERE status = 'pending' AND signals ? 'autoTriage'
       )::integer AS auto_needs_review,
       count(*) FILTER (
         WHERE status = 'pending' AND NOT (signals ? 'autoTriage')
       )::integer AS auto_untriaged
     FROM kb.review_items
     ${populationWhere}`,
    populationParams
  );
  const reasons = await database.query<{ reason: string; count: number }>(
    `SELECT value AS reason, count(*)::integer AS count
     FROM kb.review_items, jsonb_array_elements_text(reason_codes)
     ${populationWhere}
     GROUP BY value ORDER BY count(*) DESC, value`,
    populationParams
  );
  const jobs = await database.query<Record<string, unknown>>(
    `SELECT j.id::text, j.status, j.stage, j.source_path,
            e.name AS engine_name, j.total_files, j.created_at, j.finished_at,
            count(DISTINCT r.id)::integer AS review_count,
            count(DISTINCT r.id) FILTER (
              WHERE r.status = 'pending'
            )::integer AS pending_count,
            count(DISTINCT r.id) FILTER (
              WHERE r.status = 'kept'
            )::integer AS kept_count,
            count(DISTINCT r.id) FILTER (
              WHERE r.status = 'quarantined'
            )::integer AS quarantined_count,
            count(DISTINCT r.id) FILTER (
              WHERE r.status = 'skipped'
            )::integer AS skipped_count
     FROM kb.ingestion_jobs j
     JOIN kb.job_files jf ON jf.job_id = j.id
     JOIN kb.review_items r
       ON (jf.source_path = r.source_path OR jf.source_name = r.source_name)
     LEFT JOIN kb.engines e ON e.id = j.engine_id
     WHERE j.status <> 'cancelled'
     GROUP BY j.id, j.status, j.stage, j.source_path, e.name,
              j.total_files, j.created_at, j.finished_at
     HAVING count(DISTINCT r.id) FILTER (WHERE r.status = 'pending') > 0
     ORDER BY
       count(DISTINCT r.id) FILTER (WHERE r.status = 'pending') DESC,
       j.created_at DESC, j.id DESC`
  );
  return {
    items: items.rows,
    filteredTotal: Number(items.rows[0]?.filtered_total ?? 0),
    stats: stats.rows[0],
    reasons: reasons.rows,
    jobs: jobs.rows,
    limit,
    offset,
  };
}

export async function getReviewItem(id: number) {
  const database = await getKnowledgeDatabase();
  const item = await database.query<Record<string, unknown>>(
    `SELECT r.id::text, r.message_id::text, r.source_id::text,
            r.source_path, r.source_name, r.source_ordinal,
            r.raw_source_path, r.raw_start_line, r.raw_end_line,
            r.stable_id, r.thread_key, r.subject, r.author, r.message_date,
            r.content, r.origin, r.status, r.reason_codes, r.signals,
            r.reviewer_note, r.reviewed_at, r.created_at, r.updated_at
     FROM kb.review_items r WHERE r.id = $1`,
    [id]
  );
  if (!item.rows[0]) return null;
  const threadKey = String(item.rows[0].thread_key ?? '');
  const context = threadKey
    ? await database.query<Record<string, unknown>>(
        `SELECT id::text, subject, author, message_date, content, status
         FROM kb.review_items
         WHERE thread_key = $1 AND id <> $2
         ORDER BY message_date NULLS LAST, id
         LIMIT 6`,
        [threadKey, id]
      )
    : { rows: [] };
  return { item: item.rows[0], context: context.rows };
}

export async function updateReviewItem(
  id: number,
  status: ReviewStatus,
  reviewerNote: string
) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{ id: string }>(
    `UPDATE kb.review_items
     SET status = $2, reviewer_note = $3,
         signals = signals || '{"decisionSource":"human"}'::jsonb,
         reviewed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
         updated_at = now()
     WHERE id = $1
     RETURNING id::text`,
    [id, status, reviewerNote.slice(0, 4_000)]
  );
  return result.rows[0] ?? null;
}

export async function updateReviewItemsBulk(
  requestedIds: number[],
  status: Extract<ReviewStatus, 'kept' | 'quarantined'>,
  reviewerNote: string
) {
  const ids = Array.from(
    new Set(
      requestedIds.filter((id) => Number.isSafeInteger(id) && Number(id) > 0)
    )
  ).slice(0, 200);
  if (!ids.length) throw new Error('Select at least one review message.');
  const database = await getKnowledgeDatabase();
  const result = await database.query<{ id: string }>(
    `UPDATE kb.review_items
     SET status = $2, reviewer_note = $3, reviewed_at = now(),
         signals = signals || '{"decisionSource":"human"}'::jsonb,
         updated_at = now()
     WHERE id = ANY($1::bigint[])
     RETURNING id::text`,
    [`{${ids.join(',')}}`, status, reviewerNote.slice(0, 4_000)]
  );
  return { updated: result.rows.length, ids: result.rows.map((row) => row.id) };
}

const AUTO_TRIAGE_PROMPT_VERSION = 'isogeochem_review_triage_v1';
const AUTO_TRIAGE_MODEL = 'gpt-5.6-luna';
const AUTO_TRIAGE_BATCH_LIMIT = 16;
const AUTO_KEEP_CLASSES = new Set([
  'technical_answer',
  'technical_question',
  'technical_discussion',
]);
const AUTO_QUARANTINE_CLASSES = new Set([
  'event_announcement',
  'job_posting',
  'commercial',
  'list_administration',
  'social',
  'empty',
]);

function automaticStatus(result: AutoTriageResult): ReviewStatus {
  const keepTechnical =
    result.recommendation === 'keep' &&
    result.confidence >= 0.84 &&
    AUTO_KEEP_CLASSES.has(result.classification) &&
    result.knowledgeValue !== 'none';
  const keepMixed =
    result.recommendation === 'keep' &&
    result.classification === 'mixed' &&
    result.containsActionableTechnicalResponse &&
    result.confidence >= 0.9;
  if (keepTechnical || keepMixed) return 'kept';

  const quarantine =
    result.recommendation === 'quarantine' &&
    result.confidence >= (result.classification === 'empty' ? 0.99 : 0.97) &&
    AUTO_QUARANTINE_CLASSES.has(result.classification) &&
    !result.containsActionableTechnicalResponse &&
    result.technicalEvidence.length === 0 &&
    ['low', 'none'].includes(result.knowledgeValue);
  return quarantine ? 'quarantined' : 'pending';
}

export async function processAutoTriageBatch(
  requestedLimit = AUTO_TRIAGE_BATCH_LIMIT,
  jobId?: number
) {
  const limit = Math.min(
    AUTO_TRIAGE_BATCH_LIMIT,
    Math.max(1, Math.floor(requestedLimit))
  );
  const database = await getKnowledgeDatabase();
  const scopedJobId =
    Number.isSafeInteger(jobId) && Number(jobId) > 0
      ? Number(jobId)
      : undefined;
  const candidateParams: unknown[] = [];
  const jobFilter = scopedJobId
    ? `AND EXISTS (
         SELECT 1 FROM kb.job_files jf
         WHERE jf.job_id = $${candidateParams.push(scopedJobId)}
           AND (
             jf.source_path = kb.review_items.source_path
             OR jf.source_name = kb.review_items.source_name
           )
       )`
    : '';
  candidateParams.push(limit);
  const candidates = await database.query<{
    id: number;
    stable_id: string;
    thread_key: string;
    subject: string;
    author: string;
    content: string;
  }>(
    `SELECT id, stable_id, thread_key, subject, author, content
     FROM kb.review_items
     WHERE status = 'pending' AND NOT (signals ? 'autoTriage')
     ${jobFilter}
     ORDER BY id
     LIMIT $${candidateParams.length}`,
    candidateParams
  );
  if (!candidates.rows.length) {
    return {
      processed: 0,
      kept: 0,
      quarantined: 0,
      needsReview: 0,
      remaining: 0,
      model: AUTO_TRIAGE_MODEL,
    };
  }

  const inputs = await Promise.all(
    candidates.rows.map(async (candidate) => {
      const context = candidate.thread_key
        ? await database.query<{ author: string; content: string }>(
            `SELECT author, content
             FROM kb.review_items
             WHERE thread_key = $1 AND id <> $2
             ORDER BY message_date NULLS LAST, id
             LIMIT 4`,
            [candidate.thread_key, candidate.id]
          )
        : { rows: [] };
      return {
        stableId: candidate.stable_id,
        subject: candidate.subject,
        author: candidate.author,
        content: candidate.content,
        threadContext: context.rows,
      };
    })
  );
  const results = await autoTriageReviewBatch(inputs, AUTO_TRIAGE_MODEL);
  if (results.size !== candidates.rows.length) {
    throw new Error(
      `Auto-triage returned ${results.size} decisions for ${candidates.rows.length} messages. No partial batch was saved.`
    );
  }

  const counts = { kept: 0, quarantined: 0, needsReview: 0 };
  for (const candidate of candidates.rows) {
    const result = results.get(candidate.stable_id);
    if (!result) {
      throw new Error(`Auto-triage omitted message ${candidate.stable_id}.`);
    }
    const status = automaticStatus(result);
    if (status === 'kept') counts.kept += 1;
    else if (status === 'quarantined') counts.quarantined += 1;
    else counts.needsReview += 1;
    const triage = {
      ...result,
      model: AUTO_TRIAGE_MODEL,
      promptVersion: AUTO_TRIAGE_PROMPT_VERSION,
      appliedStatus: status,
      triagedAt: new Date().toISOString(),
    };
    await database.query(
      `UPDATE kb.review_items
       SET status = $2,
           signals = signals || jsonb_build_object(
             'autoTriage', $3::jsonb,
             'decisionSource', CASE WHEN $2 = 'pending' THEN 'model_review' ELSE 'model' END
           ),
           reviewer_note = $4,
           reviewed_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END,
           updated_at = now()
       WHERE id = $1 AND status = 'pending' AND NOT (signals ? 'autoTriage')`,
      [
        candidate.id,
        status,
        JSON.stringify(triage),
        `Automated triage (${AUTO_TRIAGE_MODEL}): ${result.rationale}`.slice(
          0,
          4_000
        ),
      ]
    );
  }
  const remaining = await database.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM kb.review_items
     WHERE status = 'pending' AND NOT (signals ? 'autoTriage')
     ${jobFilter}`,
    scopedJobId ? [scopedJobId] : []
  );
  return {
    processed: candidates.rows.length,
    ...counts,
    remaining: Number(remaining.rows[0]?.count ?? 0),
    model: AUTO_TRIAGE_MODEL,
  };
}

export async function getReviewSource(id: number) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{
    source_path: string;
    raw_source_path: string | null;
    source_name: string;
  }>(
    `SELECT source_path, raw_source_path, source_name
     FROM kb.review_items WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  const config = getKnowledgeConfig();
  const relativePath = row.raw_source_path || row.source_path;
  await hydrateKnowledgePath(path.resolve(config.repositoryRoot, relativePath));
  const resolved = assertPathInsideRepository(
    path.resolve(config.repositoryRoot, relativePath)
  );
  return { path: resolved, sourceName: row.source_name };
}

export async function reconcileCleanupAuditPaths() {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{ updated: number }>(
    `WITH changed AS (
       UPDATE kb.review_items
       SET source_path = CASE
           WHEN source_path LIKE 'Merged_text_files/%'
             THEN 'Raw ISOGEOCHEM data/' || substring(source_path FROM 19)
           WHEN source_path LIKE 'Raw ISOGEOCHEM data/%'
             AND raw_source_path = source_path
             THEN 'Raw ISOGEOCHEM data backup/' || substring(source_path FROM 21)
           ELSE source_path
         END,
         raw_source_path = CASE
           WHEN raw_source_path LIKE 'Raw ISOGEOCHEM data/%'
             THEN 'Raw ISOGEOCHEM data backup/' || substring(raw_source_path FROM 21)
           ELSE raw_source_path
         END,
         updated_at = now()
     WHERE origin = 'cleanup_audit'
       AND (
         source_path LIKE 'Merged_text_files/%'
         OR (
           source_path LIKE 'Raw ISOGEOCHEM data/%'
           AND raw_source_path = source_path
         )
         OR raw_source_path LIKE 'Raw ISOGEOCHEM data/%'
       )
       RETURNING 1
     )
     SELECT count(*)::integer AS updated FROM changed`
  );
  return { updated: Number(result.rows[0]?.updated ?? 0) };
}

export async function importCleanupAudit() {
  const config = getKnowledgeConfig();
  const auditPath = assertPathInsideRepository(
    path.resolve(config.repositoryRoot, 'cleanup_audit', 'decisions.jsonl')
  );
  const cleanDirectory = assertPathInsideRepository(
    path.resolve(config.repositoryRoot, 'Raw ISOGEOCHEM data')
  );
  const rawDirectory = assertPathInsideRepository(
    path.resolve(config.repositoryRoot, 'Raw ISOGEOCHEM data backup')
  );
  const lines = (await fs.readFile(auditPath, 'utf8'))
    .split('\n')
    .filter(Boolean);
  const reviewByFile = new Map<
    string,
    Array<{ decision: Record<string, unknown>; cleanOrdinal: number }>
  >();
  const quarantineByFile = new Map<string, Array<Record<string, unknown>>>();
  const retainedOrdinals = new Map<string, number>();
  for (const line of lines) {
    const decision = JSON.parse(line) as Record<string, unknown>;
    const sourceFile = String(decision.sourceFile ?? '');
    const cleanOrdinal = retainedOrdinals.get(sourceFile) ?? 0;
    if (decision.lane === 'review' && decision.searchable === true) {
      const items = reviewByFile.get(sourceFile) ?? [];
      items.push({ decision, cleanOrdinal });
      reviewByFile.set(sourceFile, items);
    } else if (decision.lane === 'quarantine') {
      const items = quarantineByFile.get(sourceFile) ?? [];
      items.push(decision);
      quarantineByFile.set(sourceFile, items);
    }
    if (decision.searchable === true) {
      retainedOrdinals.set(sourceFile, cleanOrdinal + 1);
    }
  }

  const database = await getKnowledgeDatabase();
  await reconcileCleanupAuditPaths();
  let importedReview = 0;
  let importedQuarantined = 0;
  for (const [sourceFile, items] of Array.from(reviewByFile.entries())) {
    const cleanPath = assertPathInsideRepository(
      path.resolve(cleanDirectory, sourceFile)
    );
    const parsed = parseMergedConversation(
      await fs.readFile(cleanPath, 'utf8')
    );
    for (const { decision, cleanOrdinal } of items) {
      const message = parsed[cleanOrdinal];
      if (!message) continue;
      await upsertReviewCandidate(database, {
        messageId: null,
        sourceId: null,
        sourcePath: `Raw ISOGEOCHEM data/${sourceFile}`,
        sourceName: sourceFile,
        sourceOrdinal: cleanOrdinal,
        rawSourcePath: path
          .relative(
            config.repositoryRoot,
            path.resolve(rawDirectory, sourceFile)
          )
          .split(path.sep)
          .join('/'),
        rawStartLine: Number(decision.sourceStartLine ?? 0) || null,
        rawEndLine: Number(decision.sourceEndLine ?? 0) || null,
        stableId: String(decision.stableId ?? message.stableId),
        threadKey: String(decision.threadKey ?? message.threadKey),
        subject: message.subjectNormalized,
        author: message.authorDisplay,
        messageDate: message.dateIso,
        content: message.cleanText,
        contentFingerprint: reviewFingerprint(
          message.subjectNormalized,
          message.cleanText
        ),
        origin: 'cleanup_audit',
        reasonCodes: Array.isArray(decision.reasons)
          ? decision.reasons.map(String)
          : ['ambiguous_retained_for_recall'],
        signals:
          decision.signals &&
          typeof decision.signals === 'object' &&
          !Array.isArray(decision.signals)
            ? (decision.signals as Record<string, unknown>)
            : {},
      });
      importedReview += 1;
    }
  }

  for (const [sourceFile, items] of Array.from(quarantineByFile.entries())) {
    const rawPath = assertPathInsideRepository(
      path.resolve(rawDirectory, sourceFile)
    );
    const rawRelativePath = path
      .relative(config.repositoryRoot, rawPath)
      .split(path.sep)
      .join('/');
    const parsed = parseMergedConversation(await fs.readFile(rawPath, 'utf8'));
    for (const decision of items) {
      const rawOrdinal = Number(decision.sourceOrdinal ?? -1);
      const message = parsed[rawOrdinal];
      if (!message) continue;
      await upsertReviewCandidate(database, {
        messageId: null,
        sourceId: null,
        sourcePath: rawRelativePath,
        sourceName: sourceFile,
        sourceOrdinal: rawOrdinal,
        rawSourcePath: rawRelativePath,
        rawStartLine: Number(decision.sourceStartLine ?? 0) || null,
        rawEndLine: Number(decision.sourceEndLine ?? 0) || null,
        stableId: String(decision.stableId ?? message.stableId),
        threadKey: String(decision.threadKey ?? message.threadKey),
        subject: message.subjectNormalized,
        author: message.authorDisplay,
        messageDate: message.dateIso,
        content: message.cleanText,
        contentFingerprint: reviewFingerprint(
          message.subjectNormalized,
          message.cleanText
        ),
        origin: 'cleanup_audit',
        initialStatus: 'quarantined',
        reasonCodes: Array.isArray(decision.reasons)
          ? decision.reasons.map(String)
          : ['cleanup_quarantine'],
        signals:
          decision.signals &&
          typeof decision.signals === 'object' &&
          !Array.isArray(decision.signals)
            ? (decision.signals as Record<string, unknown>)
            : {},
      });
      importedQuarantined += 1;
    }
  }
  return {
    imported: importedReview + importedQuarantined,
    review: importedReview,
    quarantined: importedQuarantined,
    files: new Set([
      ...Array.from(reviewByFile.keys()),
      ...Array.from(quarantineByFile.keys()),
    ]).size,
  };
}
