import 'server-only';

import { getKnowledgeConfig } from './config';
import { asVectorLiteral, getKnowledgeDatabase } from './db';
import {
  createEmbeddings,
  generateGroundedAnswer,
  hasOpenAIKey,
  planKnowledgeRetrieval,
  rerankEvidence,
  verifyGroundedAnswer,
} from './openai';
import type {
  KnowledgeRetrievalTrace,
  KnowledgeTraceRound,
  RetrievalEvidence,
} from './types';

const RRF_CONSTANT = 60;
const MAX_THINKING_RETRIEVAL_ROUNDS = 4;
const MAX_FOLLOW_UP_SEARCHES = 3;
const SEARCH_STOPWORDS = new Set([
  'also',
  'about',
  'after',
  'been',
  'before',
  'being',
  'could',
  'does',
  'from',
  'happens',
  'have',
  'having',
  'into',
  'patient',
  'patients',
  'should',
  'that',
  'their',
  'there',
  'these',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

const DOCUMENT_SOURCE_FORMATS = new Set([
  'image_vision',
  'markdown',
  'pdf_docling',
  'pdf_text',
  'pdf_visual',
  'plain_text',
  'spreadsheet_markdown',
]);

interface RankedId {
  id: number;
}

interface EvidenceRow {
  chunk_id: string;
  message_id: string;
  source_id: string;
  source_path: string;
  source_name: string;
  subject: string;
  author: string;
  message_date: string | null;
  start_line: number;
  end_line: number;
  content: string;
  metadata: Record<string, unknown>;
  visual_id: string | null;
  visual_page_number: number | null;
  visual_kind: string | null;
  visual_caption: string | null;
  visual_description: string | null;
  visual_alt_text: string | null;
  visual_width: number | null;
  visual_height: number | null;
  visual_bbox: Record<string, unknown> | null;
}

export type KnowledgeSearchMode = 'hybrid' | 'text' | 'semantic';

interface RetrievalOptions {
  engineId?: number;
  engineIds?: number[];
  mode?: KnowledgeSearchMode;
}

interface EngineSelection {
  engineId?: number;
  engineIds?: number[];
}

function normalizeEngineIds(engineIds: number[] | undefined) {
  if (engineIds === undefined) return undefined;
  return Array.from(
    new Set(
      engineIds
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    )
  ).slice(0, 50);
}

function addEngineScopeParams(
  params: unknown[],
  selection: EngineSelection
) {
  if (selection.engineIds !== undefined) {
    const placeholders = selection.engineIds.map(
      (id) => `$${params.push(id)}`
    );
    return {
      // IN (NULL) is a valid, deliberately empty scope. Public answer routes
      // reject an empty selection, but this keeps the lower-level API safe.
      placeholders: placeholders.join(', ') || 'NULL',
      requireEnabledEngine: true,
    };
  }
  if (selection.engineId) {
    return {
      placeholders: `$${params.push(selection.engineId)}`,
      requireEnabledEngine: false,
    };
  }
  return { placeholders: undefined, requireEnabledEngine: true };
}

function engineScope(
  placeholders?: string,
  requireEnabledEngine = true
) {
  return placeholders
    ? `EXISTS (
         SELECT 1 FROM kb.engine_sources es
         ${requireEnabledEngine ? 'JOIN kb.engines e ON e.id = es.engine_id' : ''}
         WHERE es.source_id = c.source_id
           AND es.enabled
           ${requireEnabledEngine ? 'AND e.enabled' : ''}
           AND es.engine_id IN (${placeholders})
       )`
    : `EXISTS (
         SELECT 1 FROM kb.engine_sources es
         JOIN kb.engines e ON e.id = es.engine_id
         WHERE es.source_id = c.source_id AND es.enabled AND e.enabled
       )`;
}

function extractExactTerms(question: string) {
  const specialized = [
    ...Array.from(
      question.matchAll(/\b[A-Z][A-Z0-9_-]{2,15}\b/g),
      (match) => match[0]
    ),
    ...Array.from(
      question.matchAll(/\b[A-Za-z]{0,8}\d[A-Za-z0-9._/-]{1,18}\b/g),
      (match) => match[0]
    ),
  ];
  const prose =
    question
      .toLowerCase()
      .match(/[a-z][a-z-]{2,30}/g)
      ?.filter((token) => !SEARCH_STOPWORDS.has(token)) ?? [];
  return Array.from(new Set([...specialized, ...prose])).slice(0, 16);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function broadTsQuery(question: string) {
  const tokens = question
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,30}/g)
    ?.filter((token) => !SEARCH_STOPWORDS.has(token));
  return (
    Array.from(new Set(tokens ?? []))
      .slice(0, 16)
      .join(' | ') || 'knowledge'
  );
}

function addRanks(
  scores: Map<
    number,
    {
      score: number;
      semantic: number | null;
      keyword: number | null;
      exact: number | null;
    }
  >,
  rows: RankedId[],
  kind: 'semantic' | 'keyword' | 'exact',
  weight: number
) {
  rows.forEach((row, index) => {
    const id = Number(row.id);
    const rank = index + 1;
    const current = scores.get(id) ?? {
      score: 0,
      semantic: null,
      keyword: null,
      exact: null,
    };
    current.score += weight / (RRF_CONSTANT + rank);
    current[kind] = rank;
    scores.set(id, current);
  });
}

async function hydrateEvidence(
  ids: number[],
  scores: Map<
    number,
    {
      score: number;
      semantic: number | null;
      keyword: number | null;
      exact: number | null;
    }
  >,
  selection: EngineSelection = {}
) {
  if (!ids.length) return [];
  const database = await getKnowledgeDatabase();
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const params: unknown[] = [...ids];
  const scope = addEngineScopeParams(params, selection);
  const result = await database.query<EvidenceRow>(
    `SELECT c.id::text AS chunk_id, c.message_id::text, c.source_id::text,
            s.source_path, s.source_name, c.subject,
            m.author_display AS author, m.message_date,
            coalesce((c.metadata->>'sourceStartLine')::integer, m.start_line) AS start_line,
            coalesce((c.metadata->>'sourceEndLine')::integer, m.end_line) AS end_line,
            c.content, c.metadata,
            va.id::text AS visual_id, va.page_number AS visual_page_number,
            va.kind AS visual_kind, va.caption AS visual_caption,
            va.description AS visual_description, va.alt_text AS visual_alt_text,
            va.width AS visual_width, va.height AS visual_height,
            va.bbox AS visual_bbox
     FROM kb.chunks c
     JOIN kb.messages m ON m.id = c.message_id
     JOIN kb.sources s ON s.id = c.source_id
     LEFT JOIN kb.visual_assets va ON va.chunk_id = c.id
     WHERE c.id IN (${placeholders})
       AND ${engineScope(scope.placeholders, scope.requireEnabledEngine)}
       AND NOT EXISTS (
         SELECT 1 FROM kb.review_items r
         WHERE r.message_id = c.message_id AND r.status = 'quarantined'
       )`,
    params
  );
  const byId = new Map(result.rows.map((row) => [Number(row.chunk_id), row]));
  return ids.flatMap((id): RetrievalEvidence[] => {
    const row = byId.get(id);
    const rank = scores.get(id);
    if (!row || !rank) return [];
    return [
      {
        chunkId: id,
        messageId: Number(row.message_id),
        sourceId: Number(row.source_id),
        sourcePath: row.source_path,
        sourceName: row.source_name,
        subject: row.subject,
        author: row.author,
        messageDate: row.message_date,
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
        content: row.content,
        metadata: row.metadata,
        semanticRank: rank.semantic,
        keywordRank: rank.keyword,
        exactRank: rank.exact,
        rrfScore: rank.score,
        visual: row.visual_id
          ? {
              id: Number(row.visual_id),
              pageNumber: Number(row.visual_page_number),
              kind: row.visual_kind ?? 'figure',
              caption: row.visual_caption ?? '',
              description: row.visual_description ?? '',
              altText: row.visual_alt_text ?? 'Document visual',
              width: Number(row.visual_width),
              height: Number(row.visual_height),
              bbox: row.visual_bbox ?? {},
              imageUrl: `/api/knowledge/visuals/${row.visual_id}`,
              sourceUrl: `/api/knowledge/sources/${row.source_id}/content#page=${row.visual_page_number}`,
            }
          : null,
      },
    ];
  });
}

export async function hybridRetrieve(
  question: string,
  limit = 40,
  options: RetrievalOptions = {}
) {
  const database = await getKnowledgeDatabase();
  const config = getKnowledgeConfig();
  const engineId =
    Number.isSafeInteger(options.engineId) && Number(options.engineId) > 0
      ? Number(options.engineId)
      : undefined;
  const engineIds = normalizeEngineIds(options.engineIds);
  const engineSelection: EngineSelection =
    engineIds !== undefined ? { engineIds } : { engineId };
  const mode = options.mode ?? 'hybrid';
  // Retrieve a broader pool from every branch before fusion. A branch-level
  // limit equal to the final limit made a relevant textbook passage easy to
  // crowd out by nearby passages from the same long document.
  const branchLimit = Math.max(limit * 3, 120);

  const keywordParams: unknown[] = [question, broadTsQuery(question)];
  const keywordScope = addEngineScopeParams(keywordParams, engineSelection);
  keywordParams.push(branchLimit);
  const keywordResult =
    mode === 'semantic'
      ? { rows: [] as Array<{ id: number; score: number }> }
      : await database.query<{ id: number; score: number }>(
          `WITH query AS (
       SELECT websearch_to_tsquery('simple'::regconfig, $1) AS precise,
              to_tsquery('simple'::regconfig, $2) AS broad,
              websearch_to_tsquery('english'::regconfig, $1) AS english_precise,
              to_tsquery('english'::regconfig, $2) AS english_broad
     )
     SELECT c.id,
       (2 * ts_rank_cd(c.search_vector, query.precise, 32)) +
       ts_rank_cd(c.search_vector, query.broad, 32) +
       (1.5 * ts_rank_cd(c.search_vector_english, query.english_precise, 32)) +
       ts_rank_cd(c.search_vector_english, query.english_broad, 32) AS score
     FROM kb.chunks c, query
     WHERE (c.search_vector @@ query.precise OR c.search_vector @@ query.broad
            OR c.search_vector_english @@ query.english_precise
            OR c.search_vector_english @@ query.english_broad)
       AND ${engineScope(keywordScope.placeholders, keywordScope.requireEnabledEngine)}
       AND NOT EXISTS (
         SELECT 1 FROM kb.review_items r
         WHERE r.message_id = c.message_id AND r.status = 'quarantined'
       )
     ORDER BY score DESC, c.id
     LIMIT $${keywordParams.length}`,
          keywordParams
        );

  let semanticRows: Array<{ id: number; score: number }> = [];
  const embedded = await database.query<{
    count: number;
    model: string | null;
  }>(
    `SELECT count(*)::integer AS count,
       (SELECT embedding_model FROM kb.chunks
        WHERE embedding IS NOT NULL
        GROUP BY embedding_model ORDER BY count(*) DESC LIMIT 1) AS model
     FROM kb.chunks WHERE embedding IS NOT NULL`
  );
  const embeddedCount = Number(embedded.rows[0]?.count ?? 0);
  const embeddingModel = embedded.rows[0]?.model ?? config.embeddingModel;
  if (mode !== 'text' && embeddedCount && hasOpenAIKey()) {
    const [queryEmbedding] = await createEmbeddings(
      [question],
      embeddingModel,
      config.embeddingDimensions
    );
    const semanticParams: unknown[] = [
      asVectorLiteral(queryEmbedding),
      embeddingModel,
    ];
    const semanticScope = addEngineScopeParams(
      semanticParams,
      engineSelection
    );
    semanticParams.push(branchLimit);
    const semanticResult = await database.query<{ id: number; score: number }>(
      `SELECT c.id, 1 - (c.embedding <=> $1::vector) AS score
       FROM kb.chunks c
       WHERE c.embedding IS NOT NULL AND c.embedding_model = $2
         AND ${engineScope(semanticScope.placeholders, semanticScope.requireEnabledEngine)}
         AND NOT EXISTS (
           SELECT 1 FROM kb.review_items r
           WHERE r.message_id = c.message_id
             AND r.status = 'quarantined'
         )
       ORDER BY c.embedding <=> $1::vector
       LIMIT $${semanticParams.length}`,
      semanticParams
    );
    semanticRows = semanticResult.rows;
  }

  const exactTerms = extractExactTerms(question);
  let exactRows: Array<{ id: number; score: number }> = [];
  if (mode !== 'semantic' && exactTerms.length) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    for (const term of exactTerms) {
      params.push(`%${escapeLike(term)}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(c.subject ILIKE ${placeholder} ESCAPE '\\' OR c.content ILIKE ${placeholder} ESCAPE '\\')`
      );
    }
    const exactScope = addEngineScopeParams(params, engineSelection);
    params.push(branchLimit);
    const exactResult = await database.query<{ id: number; score: number }>(
      `SELECT c.id,
         (${conditions.map((condition) => `CASE WHEN ${condition} THEN 1 ELSE 0 END`).join(' + ')})
           AS score
       FROM kb.chunks c
       WHERE (${conditions.join(' OR ')})
         AND ${engineScope(exactScope.placeholders, exactScope.requireEnabledEngine)}
         AND NOT EXISTS (
           SELECT 1 FROM kb.review_items r
           WHERE r.message_id = c.message_id AND r.status = 'quarantined'
         )
       ORDER BY score DESC, c.id
       LIMIT $${params.length}`,
      params
    );
    exactRows = exactResult.rows;
  }

  const scores = new Map<
    number,
    {
      score: number;
      semantic: number | null;
      keyword: number | null;
      exact: number | null;
    }
  >();
  addRanks(scores, semanticRows, 'semantic', 1);
  addRanks(scores, keywordResult.rows, 'keyword', 1);
  addRanks(scores, exactRows, 'exact', 1.5);

  const rankedIds = Array.from(scores.entries())
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, limit)
    .map(([id]) => id);
  return hydrateEvidence(rankedIds, scores, engineSelection);
}

export async function getKnowledgePassage(chunkId: number) {
  if (!Number.isSafeInteger(chunkId) || chunkId <= 0) return null;
  const database = await getKnowledgeDatabase();
  const result = await database.query<EvidenceRow & { engine_names: string[] }>(
    `SELECT c.id::text AS chunk_id, c.message_id::text, c.source_id::text,
            s.source_path, s.source_name, c.subject,
            m.author_display AS author, m.message_date,
            coalesce((c.metadata->>'sourceStartLine')::integer, m.start_line) AS start_line,
            coalesce((c.metadata->>'sourceEndLine')::integer, m.end_line) AS end_line,
            c.content, c.metadata,
            va.id::text AS visual_id, va.page_number AS visual_page_number,
            va.kind AS visual_kind, va.caption AS visual_caption,
            va.description AS visual_description, va.alt_text AS visual_alt_text,
            va.width AS visual_width, va.height AS visual_height,
            va.bbox AS visual_bbox,
            coalesce(array_agg(DISTINCT e.name) FILTER (WHERE e.name IS NOT NULL), '{}') AS engine_names
     FROM kb.chunks c
     JOIN kb.messages m ON m.id = c.message_id
     JOIN kb.sources s ON s.id = c.source_id
     LEFT JOIN kb.engine_sources es ON es.source_id = c.source_id
     LEFT JOIN kb.engines e ON e.id = es.engine_id
     LEFT JOIN kb.visual_assets va ON va.chunk_id = c.id
     WHERE c.id = $1
     GROUP BY c.id, m.id, s.id, va.id`,
    [chunkId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    chunkId: Number(row.chunk_id),
    sourceId: Number(row.source_id),
    sourceName: row.source_name,
    sourcePath: row.source_path,
    subject: row.subject,
    author: row.author,
    messageDate: row.message_date,
    startLine: Number(row.start_line),
    endLine: Number(row.end_line),
    content: row.content,
    metadata: row.metadata,
    engineNames: row.engine_names,
    visual: row.visual_id
      ? {
          id: Number(row.visual_id),
          pageNumber: Number(row.visual_page_number),
          kind: row.visual_kind ?? 'figure',
          caption: row.visual_caption ?? '',
          description: row.visual_description ?? '',
          altText: row.visual_alt_text ?? 'Document visual',
          width: Number(row.visual_width),
          height: Number(row.visual_height),
          bbox: row.visual_bbox ?? {},
          imageUrl: `/api/knowledge/visuals/${row.visual_id}`,
          sourceUrl: `/api/knowledge/sources/${row.source_id}/content#page=${row.visual_page_number}`,
        }
      : null,
  };
}

function mergeEvidence(left: RetrievalEvidence[], right: RetrievalEvidence[]) {
  const merged = new Map<number, RetrievalEvidence>();
  for (const evidence of [...left, ...right]) {
    const existing = merged.get(evidence.chunkId);
    if (!existing || evidence.rrfScore > existing.rrfScore) {
      merged.set(evidence.chunkId, evidence);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

function applyReranking(
  evidence: RetrievalEvidence[],
  rankings: Array<{ chunkId: number; relevance: number }>
) {
  const scores = new Map(
    rankings.map((rank) => [rank.chunkId, rank.relevance])
  );
  return evidence
    .map((item) => ({ ...item, rerankScore: scores.get(item.chunkId) ?? 0 }))
    .sort(
      (left, right) =>
        (right.rerankScore ?? 0) - (left.rerankScore ?? 0) ||
        right.rrfScore - left.rrfScore
    );
}

function diversifyFinalEvidence(evidence: RetrievalEvidence[], limit: number) {
  const perMessage = new Map<number, number>();
  const perDocument = new Map<number, number>();
  const selected: RetrievalEvidence[] = [];

  for (const item of evidence) {
    const sourceFormat = String(item.metadata.sourceFormat ?? '');
    const isDocument = DOCUMENT_SOURCE_FORMATS.has(sourceFormat);
    const counts = isDocument ? perDocument : perMessage;
    const key = isDocument ? item.sourceId : item.messageId;
    // Diversity belongs after relevance ranking. Long documents may contribute
    // several independent passages; individual emails remain tightly capped.
    const maximum = isDocument ? 4 : 2;
    const seen = counts.get(key) ?? 0;
    if (seen >= maximum) continue;
    counts.set(key, seen + 1);
    selected.push(item);
    if (selected.length >= limit) break;
  }

  return selected;
}

async function retrieveAdjacentEvidence(
  anchorChunkIds: number[],
  engineIds?: number[]
) {
  const anchors = Array.from(
    new Set(anchorChunkIds.filter((id) => Number.isSafeInteger(id) && id > 0))
  ).slice(0, 4);
  if (!anchors.length) return [];

  const database = await getKnowledgeDatabase();
  const placeholders = anchors.map((_, index) => `$${index + 1}`).join(', ');
  const params: unknown[] = [...anchors];
  const scope = addEngineScopeParams(params, { engineIds });
  const result = await database.query<{ id: number }>(
    `SELECT DISTINCT c.id
       FROM kb.chunks anchor
       JOIN kb.chunks c
         ON c.message_id = anchor.message_id
        AND c.chunk_index BETWEEN anchor.chunk_index - 1 AND anchor.chunk_index + 1
        AND c.id <> anchor.id
      WHERE anchor.id IN (${placeholders})
        AND ${engineScope(scope.placeholders, scope.requireEnabledEngine)}
        AND NOT EXISTS (
          SELECT 1 FROM kb.review_items r
           WHERE r.message_id = c.message_id AND r.status = 'quarantined'
        )
      ORDER BY c.id
      LIMIT 8`,
    params
  );
  const ids = result.rows.map((row) => Number(row.id));
  const scores = new Map(
    ids.map((id, index) => [
      id,
      {
        score: 0.5 / (RRF_CONSTANT + index + 1),
        semantic: null,
        keyword: null,
        exact: null,
      },
    ])
  );
  return hydrateEvidence(ids, scores, { engineIds });
}

export async function answerKnowledgeQuestion(params: {
  question: string;
  answerModel?: string;
  rerank?: boolean;
  engineIds?: number[];
  thinking?: boolean;
}) {
  const question = params.question.trim();
  if (!question) throw new Error('A technical question is required.');
  if (question.length > 2_000)
    throw new Error('Questions are limited to 2,000 characters.');
  if (!hasOpenAIKey()) {
    throw new Error(
      'OPENAI_API_KEY is required to generate a knowledge-base answer.'
    );
  }

  const config = getKnowledgeConfig();
  const model = params.answerModel?.trim() || config.answerModel;
  const selectedEngineIds = normalizeEngineIds(params.engineIds);
  if (params.engineIds !== undefined && !selectedEngineIds?.length) {
    throw new Error('Select at least one active knowledge engine.');
  }
  const retrievalOptions: RetrievalOptions = {
    engineIds: selectedEngineIds,
  };
  const retrievalStartedAt = Date.now();
  const retrievalQueries = [question];
  let retrievalPlanError = '';
  try {
    const plan = await planKnowledgeRetrieval(question, config.enrichmentModel);
    for (const candidate of [plan.correctedQuestion, plan.keywordQuery]) {
      const normalized = candidate.trim();
      if (
        normalized &&
        !retrievalQueries.some(
          (existing) =>
            existing.toLocaleLowerCase() === normalized.toLocaleLowerCase()
        )
      ) {
        retrievalQueries.push(normalized);
      }
    }
  } catch (error) {
    // Query planning improves recall but is never allowed to make retrieval
    // unavailable. The original question remains a complete fallback.
    retrievalPlanError =
      error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
  }
  const retrievalResults = await Promise.all(
    retrievalQueries.map((query) =>
      hybridRetrieve(query, 40, retrievalOptions)
    )
  );
  let evidence = retrievalResults.reduce<RetrievalEvidence[]>(
    (merged, current) => mergeEvidence(merged, current),
    []
  );
  const initialQueries = [...retrievalQueries];
  const initialCandidateIds = evidence.map((item) => item.chunkId);
  let refined = false;
  let refinementQuery = '';
  let stopReason = evidence.length ? 'reranking_disabled' : 'no_candidates';
  const agentRounds: KnowledgeTraceRound[] = [];

  if (evidence.length && params.rerank !== false) {
    const maximumRounds = params.thinking
      ? MAX_THINKING_RETRIEVAL_ROUNDS
      : 1;
    stopReason = 'max_rounds';
    for (let round = 1; round <= maximumRounds; round += 1) {
      let assessment: Awaited<ReturnType<typeof rerankEvidence>>;
      try {
        assessment = await rerankEvidence(
          question,
          evidence.slice(0, 40),
          model
        );
      } catch (error) {
        stopReason = 'evidence_assessment_error';
        agentRounds.push({
          round,
          candidateCount: evidence.length,
          missingFacts: [],
          followUpSearches: [],
          neighborChunkIds: [],
          addedChunkIds: [],
          error:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : 'Unknown evidence-assessment error',
        });
        break;
      }

      evidence = applyReranking(evidence, assessment.rankings);
      const validCandidateIds = new Set(
        evidence.slice(0, 40).map((item) => item.chunkId)
      );
      const neighborChunkIds = Array.from(
        new Set(
          assessment.neighborChunkIds.filter((id) => validCandidateIds.has(id))
        )
      ).slice(0, 4);
      const followUpSearches = assessment.followUpSearches
        .map((search) => ({ ...search, query: search.query.trim() }))
        .filter(
          (search) =>
            search.query &&
            !retrievalQueries.some(
              (existing) =>
                existing.toLocaleLowerCase() ===
                search.query.toLocaleLowerCase()
            )
        )
        .slice(0, MAX_FOLLOW_UP_SEARCHES);

      agentRounds.push({
        round,
        candidateCount: evidence.length,
        topChunkIds: assessment.rankings
          .slice(0, 10)
          .map((ranking) => ranking.chunkId),
        sufficientEvidence: assessment.sufficientEvidence,
        directAnswer: assessment.directAnswer,
        confidence: assessment.confidence,
        missingFacts: assessment.missingFacts,
        followUpSearches,
        neighborChunkIds,
        addedChunkIds: [],
        rationale: assessment.rationale,
      });

      if (assessment.directAnswer) {
        stopReason = 'direct_answer';
        break;
      }
      if (assessment.sufficientEvidence && assessment.confidence >= 0.65) {
        stopReason = 'evidence_sufficient';
        break;
      }
      if (round >= maximumRounds) {
        stopReason = 'max_rounds';
        break;
      }
      if (!followUpSearches.length && !neighborChunkIds.length) {
        stopReason = assessment.sufficientEvidence
          ? 'evidence_sufficient'
          : 'no_follow_up_strategy';
        break;
      }

      const beforeIds = new Set(evidence.map((item) => item.chunkId));
      const [neighbors, ...followUpResults] = await Promise.all([
        retrieveAdjacentEvidence(neighborChunkIds, selectedEngineIds),
        ...followUpSearches.map((search) =>
          hybridRetrieve(search.query, 40, {
            ...retrievalOptions,
            mode: search.mode,
          })
        ),
      ]);
      for (const search of followUpSearches) {
        retrievalQueries.push(search.query);
      }
      evidence = [neighbors, ...followUpResults].reduce(
        (merged, current) => mergeEvidence(merged, current),
        evidence
      );
      const addedIds = evidence
        .map((item) => item.chunkId)
        .filter((id) => !beforeIds.has(id));
      const currentRound = agentRounds[agentRounds.length - 1];
      currentRound.addedChunkIds = addedIds;
      if (!addedIds.length) {
        stopReason = 'no_new_evidence';
        break;
      }
      refined = true;
      refinementQuery = followUpSearches
        .map((search) => search.query)
        .join(' | ');
    }
  }

  const finalEvidence = diversifyFinalEvidence(evidence, 10);
  const retrievalMs = Date.now() - retrievalStartedAt;

  if (!finalEvidence.length) {
    const answer =
      "I don't have enough information in the knowledge base to answer this question.";
    await recordQueryTrace({
      question,
      model,
      evidence: [],
      citedIds: [],
      abstained: true,
      retrievalMs,
      generationMs: 0,
      metadata: {
        refined,
        refinementQuery,
        retrievalQueries,
        retrievalPlanError,
        initialCandidateIds,
        selectedEngineIds: selectedEngineIds ?? null,
        agentRounds,
        stopReason,
        thinking: Boolean(params.thinking),
      },
    });
    const trace: KnowledgeRetrievalTrace | undefined = params.thinking
      ? {
          mode: 'thinking',
          initialQueries,
          queries: retrievalQueries,
          initialCandidateCount: initialCandidateIds.length,
          finalEvidenceCount: 0,
          rounds: agentRounds,
          stopReason,
          retrievalMs,
          generationMs: 0,
          verificationMs: 0,
          verificationSupported: null,
          warnings: retrievalPlanError ? [retrievalPlanError] : [],
        }
      : undefined;
    return {
      answer,
      evidence: [],
      trace,
      meta: {
        abstained: true,
        refined,
        refinementQuery,
        retrievalQueries,
        selectedEngineIds: selectedEngineIds ?? null,
        agentRoundCount: agentRounds.length,
        stopReason,
        retrievalMs,
        generationMs: 0,
      },
    };
  }

  const generated = await generateGroundedAnswer(
    question,
    finalEvidence,
    model
  );
  const validIds = new Set(finalEvidence.map((item) => item.chunkId));
  let answer = generated.answer;
  let verificationMs = 0;
  let verificationSupported: boolean | null = null;
  let verificationRationale = '';
  let unsupportedClaims: string[] = [];
  let verificationError = '';

  try {
    const verification = await verifyGroundedAnswer(
      question,
      generated.answer,
      finalEvidence,
      model
    );
    verificationMs = verification.verificationMs;
    verificationSupported = verification.supported;
    verificationRationale = verification.rationale;
    unsupportedClaims = verification.unsupportedClaims;

    const verifiedAnswer = verification.verifiedAnswer.trim();
    const verifiedCitationIds = Array.from(
      new Set(
        Array.from(verifiedAnswer.matchAll(/\[KB:(\d+)\]/g), (match) =>
          Number(match[1])
        )
      )
    );
    const verifiedAbstention =
      /^\s*(?:#{1,6}\s+)?I don't have enough information in the knowledge base/i.test(
        verifiedAnswer
      );
    const mechanicallyValid =
      verifiedAnswer.length > 0 &&
      verifiedCitationIds.every((id) => validIds.has(id)) &&
      (verifiedAbstention || verifiedCitationIds.length > 0);

    if (verification.supported && mechanicallyValid) {
      answer = verifiedAnswer;
    } else {
      // A verifier that explicitly rejects its own corrected answer is safer
      // to surface as an abstention than as an unsupported fluent response.
      answer =
        "I don't have enough information in the knowledge base to provide a fully supported answer.";
      if (!mechanicallyValid && verification.supported) {
        verificationError =
          'Verifier returned an answer with missing or invalid citations.';
      }
    }
  } catch (error) {
    // Verification is an additional safety layer. If the call itself is
    // unavailable, preserve the already-grounded generator output and expose
    // the failure in the trace instead of making the endpoint unavailable.
    verificationError =
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : 'Unknown answer-verification error';
  }

  const citedIds = Array.from(
    new Set(
      Array.from(answer.matchAll(/\[KB:(\d+)\]/g), (match) =>
        Number(match[1])
      )
    )
  );
  const invalidCitations = citedIds.filter((id) => !validIds.has(id));
  const abstained =
    /^\s*(?:#{1,6}\s+)?I don't have enough information in the knowledge base/i.test(
      answer
    );
  const totalGenerationMs = generated.generationMs + verificationMs;

  await recordQueryTrace({
    question,
    model,
    evidence: finalEvidence,
    citedIds: citedIds.filter((id) => validIds.has(id)),
    abstained,
    retrievalMs,
    generationMs: totalGenerationMs,
    metadata: {
      refined,
      refinementQuery,
      retrievalQueries,
      retrievalPlanError,
      initialCandidateIds,
      selectedEngineIds: selectedEngineIds ?? null,
      agentRounds,
      stopReason,
      invalidCitations,
      draftAnswer: generated.answer,
      verificationSupported,
      verificationRationale,
      unsupportedClaims,
      verificationError,
      verificationMs,
      thinking: Boolean(params.thinking),
    },
  });
  const trace: KnowledgeRetrievalTrace | undefined = params.thinking
    ? {
        mode: 'thinking',
        initialQueries,
        queries: retrievalQueries,
        initialCandidateCount: initialCandidateIds.length,
        finalEvidenceCount: finalEvidence.length,
        rounds: agentRounds,
        stopReason,
        retrievalMs,
        generationMs: totalGenerationMs,
        verificationMs,
        verificationSupported,
        warnings: [retrievalPlanError, verificationError].filter(Boolean),
      }
    : undefined;
  return {
    answer,
    evidence: finalEvidence,
    trace,
    meta: {
      abstained,
      refined,
      refinementQuery,
      retrievalQueries,
      selectedEngineIds: selectedEngineIds ?? null,
      agentRoundCount: agentRounds.length,
      stopReason,
      retrievalMs,
      generationMs: totalGenerationMs,
      verificationMs,
      verificationSupported,
      invalidCitations,
      citationCount: citedIds.length,
    },
  };
}

async function recordQueryTrace(params: {
  question: string;
  model: string;
  evidence: RetrievalEvidence[];
  citedIds: number[];
  abstained: boolean;
  retrievalMs: number;
  generationMs: number;
  metadata: Record<string, unknown>;
}) {
  const database = await getKnowledgeDatabase();
  const config = getKnowledgeConfig();
  await database.query(
    `INSERT INTO kb.query_traces (
       question, answer_model, embedding_model, retrieved_chunk_ids,
       cited_chunk_ids, abstained, retrieval_ms, generation_ms, metadata
     ) VALUES ($1, $2, $3, $4::bigint[], $5::bigint[], $6, $7, $8, $9::jsonb)`,
    [
      params.question,
      params.model,
      config.embeddingModel,
      `{${params.evidence.map((item) => item.chunkId).join(',')}}`,
      `{${params.citedIds.join(',')}}`,
      params.abstained,
      params.retrievalMs,
      params.generationMs,
      JSON.stringify(params.metadata),
    ]
  );
}
