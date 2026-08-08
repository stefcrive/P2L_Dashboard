import 'server-only';

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { chunkMessage } from './chunker';
import {
  assertPathInsideRepository,
  getKnowledgeConfig,
  getWorkspaceEnvironmentValue,
} from './config';
import { asVectorLiteral, getKnowledgeDatabase } from './db';
import { createEmbeddings, enrichMessageBatch, hasOpenAIKey } from './openai';
import {
  parseKnowledgeDocument,
  SUPPORTED_SOURCE_EXTENSIONS,
} from './document-parser';
import {
  createIngestionReviewCandidate,
  getQuarantinedOrdinals,
} from './review';
import type {
  EnrichmentResult,
  IngestionJobOptions,
  JobStatus,
  ParsedMessage,
} from './types';

const ENRICHMENT_BATCH_SIZE = 6;
const EMBEDDING_BATCH_SIZE = 32;

function positiveIntegerEnvironment(name: string, fallback: number) {
  const parsed = Number.parseInt(
    getWorkspaceEnvironmentValue(name) ?? String(fallback),
    10
  );
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

type Queryable = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function distinct(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  );
}

async function walkSourceFiles(sourcePath: string): Promise<string[]> {
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) {
    if (
      !SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())
    ) {
      throw new Error(
        'Knowledge ingestion accepts text, Markdown, CSV, TSV, Excel, PDF, PNG, JPEG, WEBP, and GIF files.'
      );
    }
    return [sourcePath];
  }
  if (!stat.isDirectory())
    throw new Error('The knowledge source is not a file or directory.');

  const files: string[] = [];
  const pending = [sourcePath];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (
        entry.isFile() &&
        SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(entryPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function validateJobOptions(options: IngestionJobOptions) {
  if (!['parse_only', 'indexed', 'enriched'].includes(options.mode)) {
    throw new Error('Invalid ingestion mode.');
  }
  if (options.embeddingDimensions !== 1024) {
    throw new Error('This knowledge schema uses 1024-dimensional embeddings.');
  }
  if (options.chunkTargetTokens < 200 || options.chunkTargetTokens > 1600) {
    throw new Error('Chunk target must be between 200 and 1600 tokens.');
  }
  if (
    options.chunkOverlapTokens < 0 ||
    options.chunkOverlapTokens > 400 ||
    options.chunkOverlapTokens >= options.chunkTargetTokens
  ) {
    throw new Error(
      'Chunk overlap must be smaller than the target and at most 400 tokens.'
    );
  }
  if (options.mode !== 'parse_only' && !hasOpenAIKey()) {
    throw new Error(
      'OPENAI_API_KEY is required for indexed or enriched ingestion.'
    );
  }
}

export async function createIngestionJob(options: IngestionJobOptions) {
  validateJobOptions(options);
  const config = getKnowledgeConfig();
  const requestedPath = path.isAbsolute(options.sourcePath)
    ? options.sourcePath
    : path.resolve(config.repositoryRoot, options.sourcePath);
  const sourcePath = assertPathInsideRepository(requestedPath);
  const files = await walkSourceFiles(sourcePath);
  if (!files.length) {
    throw new Error(
      'No supported files were found. Add text, Markdown, CSV, TSV, Excel, PDF, PNG, JPEG, WEBP, or GIF files.'
    );
  }
  const fileRecords = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      stat: await fs.stat(filePath),
    }))
  );
  const maximumFileBytes =
    positiveIntegerEnvironment('KNOWLEDGE_MAX_SOURCE_FILE_MB', 32) * 1_048_576;
  const oversized = fileRecords.filter(
    ({ stat }) => stat.size > maximumFileBytes
  );
  if (oversized.length) {
    throw new Error(
      `${oversized.length} source file(s) exceed the ${Math.round(
        maximumFileBytes / 1_048_576
      )} MB safety limit. Split large conversations or raise KNOWLEDGE_MAX_SOURCE_FILE_MB deliberately.`
    );
  }

  const database = await getKnowledgeDatabase();
  return database.transaction(async (transaction) => {
    const duplicate = await transaction.query<{ id: number }>(
      `SELECT id
       FROM kb.ingestion_jobs
       WHERE source_path = $1
         AND mode = $2
         AND enrichment_model IS NOT DISTINCT FROM $3
         AND embedding_model IS NOT DISTINCT FROM $4
         AND embedding_dimensions = $5
         AND chunk_target_tokens = $6
         AND chunk_overlap_tokens = $7
         AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        sourcePath,
        options.mode,
        options.mode === 'enriched' ? options.enrichmentModel : null,
        options.mode === 'parse_only' ? null : options.embeddingModel,
        options.embeddingDimensions,
        options.chunkTargetTokens,
        options.chunkOverlapTokens,
      ]
    );
    if (duplicate.rows[0]) {
      return {
        jobId: Number(duplicate.rows[0].id),
        totalFiles: files.length,
        reused: true,
      };
    }

    const inserted = await transaction.query<{ id: number }>(
      `INSERT INTO kb.ingestion_jobs (
        mode, source_path, enrichment_model, embedding_model, embedding_dimensions,
        chunk_target_tokens, chunk_overlap_tokens, total_files
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        options.mode,
        sourcePath,
        options.mode === 'enriched' ? options.enrichmentModel : null,
        options.mode === 'parse_only' ? null : options.embeddingModel,
        options.embeddingDimensions,
        options.chunkTargetTokens,
        options.chunkOverlapTokens,
        files.length,
      ]
    );
    const jobId = Number(inserted.rows[0].id);
    for (const { filePath, stat } of fileRecords) {
      await transaction.query(
        `INSERT INTO kb.job_files (job_id, source_path, source_name, byte_size)
         VALUES ($1, $2, $3, $4)`,
        [jobId, filePath, path.basename(filePath), stat.size]
      );
    }
    return { jobId, totalFiles: files.length };
  });
}

async function updateStages(
  database: Queryable,
  jobId: number,
  fileId: number,
  stage: string
) {
  await database.query(
    `UPDATE kb.ingestion_jobs
       SET status = CASE
             WHEN status IN ('paused', 'cancelled') THEN status
             ELSE 'running'
           END,
           stage = $2, started_at = coalesce(started_at, now()),
           heartbeat_at = now(), updated_at = now()
     WHERE id = $1`,
    [jobId, stage]
  );
  await database.query(
    `UPDATE kb.job_files SET stage = $2, updated_at = now() WHERE id = $1`,
    [fileId, stage]
  );
}

async function claimNextFile(jobId: number) {
  const database = await getKnowledgeDatabase();
  return database.transaction(async (transaction) => {
    const jobResult = await transaction.query<{
      status: JobStatus;
      running_files: number;
    }>(
      `SELECT j.status,
         (SELECT count(*)::integer FROM kb.job_files f
           WHERE f.job_id = j.id AND f.status = 'running') AS running_files
       FROM kb.ingestion_jobs j WHERE j.id = $1`,
      [jobId]
    );
    const job = jobResult.rows[0];
    if (!job) throw new Error('Ingestion job not found.');
    if (
      job.status === 'paused' ||
      job.status === 'cancelled' ||
      job.status === 'completed'
    ) {
      return null;
    }
    if (Number(job.running_files) > 0) {
      return { busy: true as const };
    }
    const next = await transaction.query<{
      id: number;
      source_path: string;
      source_name: string;
      byte_size: number;
    }>(
      `SELECT id, source_path, source_name, byte_size
       FROM kb.job_files
       WHERE job_id = $1 AND status = 'queued'
       ORDER BY id
       LIMIT 1`,
      [jobId]
    );
    const file = next.rows[0];
    if (!file) return null;
    await transaction.query(
      `UPDATE kb.job_files
       SET status = 'running', stage = 'parse', started_at = now(), updated_at = now()
       WHERE id = $1`,
      [file.id]
    );
    await transaction.query(
      `UPDATE kb.ingestion_jobs
       SET status = 'running', stage = 'parse', current_file = $2,
           started_at = coalesce(started_at, now()), heartbeat_at = now(), updated_at = now()
       WHERE id = $1`,
      [jobId, file.source_name]
    );
    return {
      busy: false as const,
      id: Number(file.id),
      sourcePath: file.source_path,
      sourceName: file.source_name,
      byteSize: Number(file.byte_size),
    };
  });
}

async function getJobOptions(jobId: number) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{
    mode: IngestionJobOptions['mode'];
    enrichment_model: string | null;
    embedding_model: string | null;
    embedding_dimensions: number;
    chunk_target_tokens: number;
    chunk_overlap_tokens: number;
  }>(
    `SELECT mode, enrichment_model, embedding_model, embedding_dimensions,
            chunk_target_tokens, chunk_overlap_tokens
     FROM kb.ingestion_jobs WHERE id = $1`,
    [jobId]
  );
  if (!result.rows[0]) throw new Error('Ingestion job not found.');
  return result.rows[0];
}

async function enrichMessages(messages: ParsedMessage[], model: string) {
  const results = new Map<string, EnrichmentResult>();
  for (let index = 0; index < messages.length; index += ENRICHMENT_BATCH_SIZE) {
    const batch = messages.slice(index, index + ENRICHMENT_BATCH_SIZE);
    const batchResults = await enrichMessageBatch(batch, model);
    for (const [stableId, enrichment] of Array.from(batchResults.entries())) {
      results.set(stableId, enrichment);
    }
  }
  return results;
}

function mergedMetadata(
  message: ParsedMessage,
  enrichment: EnrichmentResult | undefined
) {
  if (!enrichment) return message.deterministicMetadata;
  const deterministic = message.deterministicMetadata as Record<
    string,
    string[]
  >;
  return {
    ...message.deterministicMetadata,
    products: distinct([
      ...(deterministic.products ?? []),
      ...enrichment.products,
    ]),
    components: distinct([
      ...(deterministic.components ?? []),
      ...enrichment.components,
    ]),
    technologies: distinct([
      ...(deterministic.technologies ?? []),
      ...enrichment.technologies,
    ]),
    methods: distinct([
      ...(deterministic.methods ?? []),
      ...enrichment.methods,
    ]),
    isotopes: distinct([
      ...(deterministic.isotopes ?? []),
      ...enrichment.isotopes,
    ]),
    errorCodes: distinct([
      ...(deterministic.errorCodes ?? []),
      ...enrichment.errorCodes,
    ]),
    enrichmentWarnings: enrichment.warnings,
    enrichmentIsDerived: true,
  };
}

async function findReusableSource(
  sourcePath: string,
  fileSha: string,
  mode: IngestionJobOptions['mode'],
  embeddingModel: string | null,
  enrichmentModel: string | null,
  targetTokens: number,
  overlapTokens: number,
  parserVersion: string
) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{
    id: number;
    message_count: number;
    chunk_count: number;
    embedded_count: number;
    model_count: number;
    metadata: Record<string, unknown>;
  }>(
    `SELECT s.id, s.message_count, s.chunk_count, s.metadata,
       count(c.embedding)::integer AS embedded_count,
       count(c.embedding) FILTER (WHERE c.embedding_model = $3)::integer AS model_count
     FROM kb.sources s
     LEFT JOIN kb.chunks c ON c.source_id = s.id
     WHERE s.source_path = $1 AND s.sha256 = $2
     GROUP BY s.id`,
    [sourcePath, fileSha, embeddingModel]
  );
  const source = result.rows[0];
  if (!source) return { sourceId: null, reusable: false };
  const chunkCount = Number(source.chunk_count);
  const metadata = source.metadata ?? {};
  const baseCompatible =
    metadata.parser === parserVersion &&
    Number(metadata.chunkTargetTokens) === targetTokens &&
    Number(metadata.chunkOverlapTokens) === overlapTokens;
  const enrichedCompatible =
    mode !== 'enriched' ||
    (metadata.ingestionMode === 'enriched' &&
      metadata.enrichmentModel === enrichmentModel);
  const reusable =
    baseCompatible &&
    enrichedCompatible &&
    Number(source.message_count) > 0 &&
    (mode === 'parse_only' ||
      (chunkCount > 0 &&
        Number(source.embedded_count) === chunkCount &&
        Number(source.model_count) === chunkCount));
  return { sourceId: Number(source.id), reusable };
}

async function persistFile(params: {
  sourceId: number | null;
  relativeSourcePath: string;
  sourceName: string;
  fileSha: string;
  byteSize: number;
  modifiedAt: string;
  messages: ParsedMessage[];
  enrichments: Map<string, EnrichmentResult>;
  embeddings: number[][];
  embeddingModel: string | null;
  ingestionMode: IngestionJobOptions['mode'];
  enrichmentModel: string | null;
  targetTokens: number;
  overlapTokens: number;
  parserVersion: string;
  sourceFormat: string;
}) {
  const database = await getKnowledgeDatabase();
  let embeddingCursor = 0;
  return database.transaction(async (transaction) => {
    let sourceId = params.sourceId;
    if (sourceId) {
      await transaction.query(`DELETE FROM kb.messages WHERE source_id = $1`, [
        sourceId,
      ]);
      await transaction.query(
        `UPDATE kb.sources
         SET status = 'processing', byte_size = $2, modified_at = $3::timestamptz,
             format = $4,
             message_count = 0, chunk_count = 0, warning_count = 0, updated_at = now()
         WHERE id = $1`,
        [sourceId, params.byteSize, params.modifiedAt, params.sourceFormat]
      );
    } else {
      const inserted = await transaction.query<{ id: number }>(
        `INSERT INTO kb.sources (
          source_path, source_name, sha256, byte_size, modified_at, format, status
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, 'processing')
        RETURNING id`,
        [
          params.relativeSourcePath,
          params.sourceName,
          params.fileSha,
          params.byteSize,
          params.modifiedAt,
          params.sourceFormat,
        ]
      );
      sourceId = Number(inserted.rows[0].id);
      await transaction.query(
        `UPDATE kb.sources SET status = 'obsolete', updated_at = now()
         WHERE source_path = $1 AND id <> $2 AND status <> 'obsolete'`,
        [params.relativeSourcePath, sourceId]
      );
    }

    let chunkCount = 0;
    let warningCount = 0;
    for (
      let messageIndex = 0;
      messageIndex < params.messages.length;
      messageIndex += 1
    ) {
      const message = params.messages[messageIndex];
      const enrichment = params.enrichments.get(message.stableId);
      const metadata = mergedMetadata(message, enrichment);
      const insertedMessage = await transaction.query<{ id: number }>(
        `INSERT INTO kb.messages (
          source_id, source_ordinal, stable_id, thread_key, subject_raw,
          subject_normalized, author_raw, author_display, author_email_hash,
          date_raw, message_date, body_raw, body_new, quoted_history,
          signature_text, clean_text, start_offset, end_offset, start_line,
          end_line, relevance, summary, metadata, parser_warnings
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz,
          $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          $23::jsonb, $24::jsonb
        ) RETURNING id`,
        [
          sourceId,
          message.sourceOrdinal,
          message.stableId,
          message.threadKey,
          message.subjectRaw,
          message.subjectNormalized,
          message.authorRaw,
          message.authorDisplay,
          message.authorEmailHash,
          message.dateRaw,
          message.dateIso,
          message.bodyRaw,
          message.bodyNew,
          message.quotedHistory,
          message.signatureText,
          message.cleanText,
          message.startOffset,
          message.endOffset,
          message.startLine,
          message.endLine,
          enrichment?.relevance ?? 'unknown',
          enrichment?.summary ?? '',
          JSON.stringify(metadata),
          JSON.stringify(message.warnings),
        ]
      );
      const messageId = Number(insertedMessage.rows[0].id);
      await createIngestionReviewCandidate({
        database: transaction,
        message,
        messageId,
        sourceId,
        sourcePath: params.relativeSourcePath,
        sourceName: params.sourceName,
        enrichment,
      });
      const chunks = chunkMessage(
        message,
        params.targetTokens,
        params.overlapTokens
      );
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const chunkMetadata = { ...chunk.metadata, ...metadata };
        const embedding = params.embeddingModel
          ? params.embeddings[embeddingCursor++]
          : null;
        await transaction.query(
          `INSERT INTO kb.chunks (
            source_id, message_id, chunk_index, subject, content,
            contextual_content, content_sha256, approx_tokens, start_offset,
            end_offset, embedding, embedding_model, metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11::vector, $12, $13::jsonb
          )`,
          [
            sourceId,
            messageId,
            chunk.chunkIndex,
            message.subjectNormalized,
            chunk.content,
            chunk.contextualContent,
            chunk.contentSha256,
            chunk.approxTokens,
            chunk.startOffset,
            chunk.endOffset,
            embedding ? asVectorLiteral(embedding) : null,
            params.embeddingModel,
            JSON.stringify(chunkMetadata),
          ]
        );
        chunkCount += 1;
        if (chunkIndex > 0 && chunkIndex % 50 === 0) {
          await yieldToEventLoop();
        }
      }
      warningCount += message.warnings.length;
      if (messageIndex > 0 && messageIndex % 25 === 0) {
        await yieldToEventLoop();
      }
    }

    await transaction.query(
      `UPDATE kb.sources
       SET status = $2, message_count = $3, chunk_count = $4,
           warning_count = $5, metadata = $6::jsonb, updated_at = now()
       WHERE id = $1`,
      [
        sourceId,
        warningCount ? 'warning' : 'indexed',
        params.messages.length,
        chunkCount,
        warningCount,
        JSON.stringify({
          parser: params.parserVersion,
          sourceFormat: params.sourceFormat,
          ingestionMode: params.ingestionMode,
          enrichmentModel: params.enrichmentModel,
          chunkTargetTokens: params.targetTokens,
          chunkOverlapTokens: params.overlapTokens,
          embeddingModel: params.embeddingModel,
        }),
      ]
    );
    return { sourceId, chunkCount, warningCount };
  });
}

async function finalizeJob(jobId: number) {
  const database = await getKnowledgeDatabase();
  const totals = await database.query<{
    queued: number;
    running: number;
    completed: number;
    skipped: number;
    failed: number;
    messages: number;
    chunks: number;
    embedded: number;
  }>(
    `SELECT
      count(*) FILTER (WHERE status = 'queued')::integer AS queued,
      count(*) FILTER (WHERE status = 'running')::integer AS running,
      count(*) FILTER (WHERE status = 'completed')::integer AS completed,
      count(*) FILTER (WHERE status = 'skipped')::integer AS skipped,
      count(*) FILTER (WHERE status = 'failed')::integer AS failed,
      coalesce(sum(message_count), 0)::integer AS messages,
      coalesce(sum(chunk_count), 0)::integer AS chunks,
      coalesce(sum(embedded_chunks), 0)::integer AS embedded
     FROM kb.job_files WHERE job_id = $1`,
    [jobId]
  );
  const total = totals.rows[0];
  const finished = Number(total.queued) === 0 && Number(total.running) === 0;
  const status =
    finished &&
    Number(total.failed) > 0 &&
    Number(total.completed) + Number(total.skipped) === 0
      ? 'failed'
      : finished
        ? 'completed'
        : 'running';
  await database.query(
    `UPDATE kb.ingestion_jobs SET
       status = CASE
         WHEN status = 'cancelled' THEN 'cancelled'
         WHEN status = 'paused' AND NOT $3 THEN 'paused'
         ELSE $2
       END,
       stage = CASE
         WHEN status IN ('paused', 'cancelled') AND NOT $3 THEN stage
         WHEN $3 THEN 'complete'
         ELSE stage
       END,
       processed_files = $4, skipped_files = $5, failed_files = $6,
       total_messages = $7, total_chunks = $8, embedded_chunks = $9,
       current_file = NULL,
       heartbeat_at = now(), finished_at = CASE
         WHEN status = 'cancelled' THEN coalesce(finished_at, now())
         WHEN $3 THEN now()
         ELSE NULL
       END,
       updated_at = now()
     WHERE id = $1`,
    [
      jobId,
      status,
      finished,
      Number(total.completed),
      Number(total.skipped),
      Number(total.failed),
      Number(total.messages),
      Number(total.chunks),
      Number(total.embedded),
    ]
  );
  return { finished, status };
}

export async function processJobStep(jobId: number) {
  const file = await claimNextFile(jobId);
  if (!file) return { ...(await finalizeJob(jobId)), processed: false };
  if (file.busy)
    return { finished: false, status: 'running', processed: false, busy: true };

  const database = await getKnowledgeDatabase();
  const options = await getJobOptions(jobId);
  try {
    const rawBuffer = await fs.readFile(file.sourcePath);
    const fileSha = sha256(rawBuffer);
    await database.query(`UPDATE kb.job_files SET sha256 = $2 WHERE id = $1`, [
      file.id,
      fileSha,
    ]);

    const config = getKnowledgeConfig();
    const relativeSourcePath = path
      .relative(config.repositoryRoot, file.sourcePath)
      .split(path.sep)
      .join('/');
    await updateStages(database, jobId, file.id, 'parse');
    const parsedDocument = await parseKnowledgeDocument(
      file.sourcePath,
      rawBuffer
    );
    const reusable = await findReusableSource(
      relativeSourcePath,
      fileSha,
      options.mode,
      options.embedding_model,
      options.enrichment_model,
      Number(options.chunk_target_tokens),
      Number(options.chunk_overlap_tokens),
      parsedDocument.parserVersion
    );
    if (reusable.reusable) {
      await database.query(
        `UPDATE kb.job_files
         SET status = 'skipped', stage = 'complete', finished_at = now(), updated_at = now()
         WHERE id = $1`,
        [file.id]
      );
      return { ...(await finalizeJob(jobId)), processed: true, skipped: true };
    }

    const parsedMessages = parsedDocument.messages;
    if (!parsedMessages.length) {
      throw new Error(
        'No valid Subject/Author/Date message records were found.'
      );
    }
    const quarantinedOrdinals = await getQuarantinedOrdinals(
      relativeSourcePath,
      parsedMessages
    );
    const messages = parsedMessages.filter(
      (message) => !quarantinedOrdinals.has(message.sourceOrdinal)
    );

    await updateStages(database, jobId, file.id, 'clean');
    let enrichments = new Map<string, EnrichmentResult>();
    if (options.mode === 'enriched') {
      await updateStages(database, jobId, file.id, 'enrich');
      enrichments = await enrichMessages(messages, options.enrichment_model!);
    }

    const allChunks = messages.flatMap((message) =>
      chunkMessage(
        message,
        Number(options.chunk_target_tokens),
        Number(options.chunk_overlap_tokens)
      )
    );
    const maximumChunks = positiveIntegerEnvironment(
      'KNOWLEDGE_MAX_CHUNKS_PER_FILE',
      10_000
    );
    if (allChunks.length > maximumChunks) {
      throw new Error(
        `${file.sourceName} produced ${allChunks.length} chunks, above the ${maximumChunks} chunk safety limit. Split the source file before ingestion.`
      );
    }
    const embeddings: number[][] = [];
    if (options.mode !== 'parse_only') {
      await updateStages(database, jobId, file.id, 'embed');
      for (
        let index = 0;
        index < allChunks.length;
        index += EMBEDDING_BATCH_SIZE
      ) {
        const batch = allChunks.slice(index, index + EMBEDDING_BATCH_SIZE);
        embeddings.push(
          ...(await createEmbeddings(
            batch.map((chunk) => chunk.contextualContent),
            options.embedding_model!,
            Number(options.embedding_dimensions)
          ))
        );
        await database.query(
          `UPDATE kb.job_files SET embedded_chunks = $2, updated_at = now() WHERE id = $1`,
          [file.id, embeddings.length]
        );
        await database.query(
          `UPDATE kb.ingestion_jobs SET heartbeat_at = now(), updated_at = now() WHERE id = $1`,
          [jobId]
        );
      }
    }

    await updateStages(database, jobId, file.id, 'index');
    const stat = await fs.stat(file.sourcePath);
    const persisted = await persistFile({
      sourceId: reusable.sourceId,
      relativeSourcePath,
      sourceName: file.sourceName,
      fileSha,
      byteSize: rawBuffer.byteLength,
      modifiedAt: stat.mtime.toISOString(),
      messages,
      enrichments,
      embeddings,
      embeddingModel: options.embedding_model,
      ingestionMode: options.mode,
      enrichmentModel: options.enrichment_model,
      targetTokens: Number(options.chunk_target_tokens),
      overlapTokens: Number(options.chunk_overlap_tokens),
      parserVersion: parsedDocument.parserVersion,
      sourceFormat: parsedDocument.sourceFormat,
    });
    await database.query(
      `UPDATE kb.job_files SET
         status = 'completed', stage = 'complete', message_count = $2,
         chunk_count = $3, embedded_chunks = $4, warning_count = $5,
         finished_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        file.id,
        messages.length,
        persisted.chunkCount,
        embeddings.length,
        persisted.warningCount,
      ]
    );
    return {
      ...(await finalizeJob(jobId)),
      processed: true,
      file: file.sourceName,
      messages: messages.length,
      chunks: persisted.chunkCount,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown ingestion failure.';
    await database.query(
      `UPDATE kb.job_files SET
         status = 'failed', error = $2, finished_at = now(), updated_at = now()
       WHERE id = $1`,
      [file.id, message.slice(0, 4_000)]
    );
    await database.query(
      `UPDATE kb.ingestion_jobs SET
         last_error = $2, heartbeat_at = now(), updated_at = now()
       WHERE id = $1`,
      [jobId, message.slice(0, 4_000)]
    );
    return {
      ...(await finalizeJob(jobId)),
      processed: true,
      failed: true,
      error: message,
    };
  }
}

export async function controlIngestionJob(
  jobId: number,
  action: 'pause' | 'resume' | 'cancel'
) {
  const database = await getKnowledgeDatabase();
  const nextStatus =
    action === 'pause'
      ? 'paused'
      : action === 'resume'
        ? 'queued'
        : 'cancelled';
  const result = await database.query<{ id: number; status: JobStatus }>(
    `UPDATE kb.ingestion_jobs
     SET status = $2,
         finished_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE finished_at END,
         updated_at = now()
     WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
     RETURNING id, status`,
    [jobId, nextStatus]
  );
  if (!result.rows[0]) throw new Error('Job not found or already finished.');
  return result.rows[0];
}

export async function getKnowledgeOverview() {
  const database = await getKnowledgeDatabase();
  const config = getKnowledgeConfig();
  const [countsResult, jobsResult, sourcesResult, jobFilesResult] =
    await Promise.all([
      database.query<{
        sources: number;
        messages: number;
        chunks: number;
        embedded_chunks: number;
        active_jobs: number;
      }>(`SELECT
      (SELECT count(*)::integer FROM kb.sources WHERE status <> 'obsolete') AS sources,
      (SELECT count(*)::integer FROM kb.messages) AS messages,
      (SELECT count(*)::integer FROM kb.chunks) AS chunks,
      (SELECT count(*)::integer FROM kb.chunks WHERE embedding IS NOT NULL) AS embedded_chunks,
      (SELECT count(*)::integer FROM kb.ingestion_jobs
        WHERE status IN ('queued', 'running', 'paused')) AS active_jobs`),
      database.query<Record<string, unknown> & { id: string }>(
        `SELECT id::text, status, stage, mode, source_path, enrichment_model,
              embedding_model, total_files, processed_files, skipped_files,
              failed_files, total_messages, total_chunks, embedded_chunks,
              current_file, last_error, chunk_target_tokens, chunk_overlap_tokens,
              created_at, heartbeat_at, finished_at
       FROM kb.ingestion_jobs ORDER BY created_at DESC LIMIT 20`
      ),
      database.query<Record<string, unknown> & { id: string }>(
        `SELECT id::text, source_name, source_path, sha256, byte_size, status,
              message_count, chunk_count, warning_count, modified_at, updated_at,
              metadata
       FROM kb.sources ORDER BY updated_at DESC LIMIT 100`
      ),
      database.query<Record<string, unknown> & { job_id: string }>(
        `SELECT f.id::text, f.job_id::text, f.source_name, f.status, f.stage,
              f.message_count, f.chunk_count, f.embedded_chunks, f.warning_count,
              f.error
       FROM kb.job_files f
       JOIN (
         SELECT id FROM kb.ingestion_jobs ORDER BY created_at DESC LIMIT 20
       ) recent ON recent.id = f.job_id
       ORDER BY f.job_id DESC, f.id`
      ),
    ]);
  const counts = countsResult.rows[0];
  return {
    database: {
      engine: 'PGlite / PostgreSQL with pgvector',
      path: config.databasePath,
      portableTarget: 'Supabase PostgreSQL',
      openAIConfigured: hasOpenAIKey(),
    },
    counts: {
      sources: Number(counts.sources),
      messages: Number(counts.messages),
      chunks: Number(counts.chunks),
      embeddedChunks: Number(counts.embedded_chunks),
      activeJobs: Number(counts.active_jobs),
    },
    jobs: jobsResult.rows.map((job) => ({
      ...job,
      files: jobFilesResult.rows.filter(
        (file) => String(file.job_id) === String(job.id)
      ),
    })),
    sources: sourcesResult.rows,
    defaults: {
      sourcePath: config.defaultSourcePath,
      enrichmentModel: config.enrichmentModel,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      answerModel: config.answerModel,
    },
  };
}
