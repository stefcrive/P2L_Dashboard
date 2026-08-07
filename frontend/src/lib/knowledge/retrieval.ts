import 'server-only';

import { getKnowledgeConfig } from './config';
import { asVectorLiteral, getKnowledgeDatabase } from './db';
import {
  createEmbeddings,
  generateGroundedAnswer,
  hasOpenAIKey,
  rerankEvidence,
} from './openai';
import type { RetrievalEvidence } from './types';

const RRF_CONSTANT = 60;
const SEARCH_STOPWORDS = new Set([
  'about',
  'after',
  'before',
  'could',
  'does',
  'from',
  'have',
  'into',
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
}

function extractExactTerms(question: string) {
  const candidates = [
    ...Array.from(
      question.matchAll(/\b[A-Z][A-Z0-9_-]{2,15}\b/g),
      (match) => match[0],
    ),
    ...Array.from(
      question.matchAll(/\b[A-Za-z]{0,8}\d[A-Za-z0-9._/-]{1,18}\b/g),
      (match) => match[0],
    ),
  ];
  return Array.from(new Set(candidates)).slice(0, 6);
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function broadTsQuery(question: string) {
  const tokens = question
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,30}/g)
    ?.filter((token) => !SEARCH_STOPWORDS.has(token));
  return Array.from(new Set(tokens ?? [])).slice(0, 16).join(' | ') || 'knowledge';
}

function addRanks(
  scores: Map<number, { score: number; semantic: number | null; keyword: number | null; exact: number | null }>,
  rows: RankedId[],
  kind: 'semantic' | 'keyword' | 'exact',
  weight: number,
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
  scores: Map<number, { score: number; semantic: number | null; keyword: number | null; exact: number | null }>,
) {
  if (!ids.length) return [];
  const database = await getKnowledgeDatabase();
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const result = await database.query<EvidenceRow>(
    `SELECT c.id::text AS chunk_id, c.message_id::text, c.source_id::text,
            s.source_path, s.source_name, c.subject,
            m.author_display AS author, m.message_date,
            coalesce((c.metadata->>'sourceStartLine')::integer, m.start_line) AS start_line,
            coalesce((c.metadata->>'sourceEndLine')::integer, m.end_line) AS end_line,
            c.content, c.metadata
     FROM kb.chunks c
     JOIN kb.messages m ON m.id = c.message_id
     JOIN kb.sources s ON s.id = c.source_id
     WHERE c.id IN (${placeholders})`,
    ids,
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
      },
    ];
  });
}

export async function hybridRetrieve(question: string, limit = 40) {
  const database = await getKnowledgeDatabase();
  const config = getKnowledgeConfig();

  const keywordResult = await database.query<{ id: number; score: number }>(
    `WITH query AS (
       SELECT websearch_to_tsquery('simple'::regconfig, $1) AS precise,
              to_tsquery('simple'::regconfig, $2) AS broad
     )
     SELECT c.id,
       (2 * ts_rank_cd(c.search_vector, query.precise, 32)) +
       ts_rank_cd(c.search_vector, query.broad, 32) AS score
     FROM kb.chunks c, query
     WHERE c.search_vector @@ query.precise OR c.search_vector @@ query.broad
     ORDER BY score DESC, c.id
     LIMIT $3`,
    [question, broadTsQuery(question), limit],
  );

  let semanticRows: Array<{ id: number; score: number }> = [];
  const embedded = await database.query<{ count: number; model: string | null }>(
    `SELECT count(*)::integer AS count,
       (SELECT embedding_model FROM kb.chunks
        WHERE embedding IS NOT NULL
        GROUP BY embedding_model ORDER BY count(*) DESC LIMIT 1) AS model
     FROM kb.chunks WHERE embedding IS NOT NULL`,
  );
  const embeddedCount = Number(embedded.rows[0]?.count ?? 0);
  const embeddingModel = embedded.rows[0]?.model ?? config.embeddingModel;
  if (embeddedCount && hasOpenAIKey()) {
    const [queryEmbedding] = await createEmbeddings(
      [question],
      embeddingModel,
      config.embeddingDimensions,
    );
    const semanticResult = await database.query<{ id: number; score: number }>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS score
       FROM kb.chunks
       WHERE embedding IS NOT NULL AND embedding_model = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [asVectorLiteral(queryEmbedding), embeddingModel, limit],
    );
    semanticRows = semanticResult.rows;
  }

  const exactTerms = extractExactTerms(question);
  let exactRows: Array<{ id: number; score: number }> = [];
  if (exactTerms.length) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    for (const term of exactTerms) {
      params.push(`%${escapeLike(term)}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(c.subject ILIKE ${placeholder} ESCAPE '\\' OR c.content ILIKE ${placeholder} ESCAPE '\\')`,
      );
    }
    params.push(limit);
    const exactResult = await database.query<{ id: number; score: number }>(
      `SELECT c.id,
         (${conditions.map((condition) => `CASE WHEN ${condition} THEN 1 ELSE 0 END`).join(' + ')})
           AS score
       FROM kb.chunks c
       WHERE ${conditions.join(' OR ')}
       ORDER BY score DESC, c.id
       LIMIT $${params.length}`,
      params,
    );
    exactRows = exactResult.rows;
  }

  const scores = new Map<
    number,
    { score: number; semantic: number | null; keyword: number | null; exact: number | null }
  >();
  addRanks(scores, semanticRows, 'semantic', 1);
  addRanks(scores, keywordResult.rows, 'keyword', 1);
  addRanks(scores, exactRows, 'exact', 1.5);

  const rankedIds = Array.from(scores.entries())
    .sort((left, right) => right[1].score - left[1].score)
    .map(([id]) => id);
  const hydrated = await hydrateEvidence(rankedIds, scores);

  const perMessage = new Map<number, number>();
  return hydrated.filter((evidence) => {
    const seen = perMessage.get(evidence.messageId) ?? 0;
    if (seen >= 2) return false;
    perMessage.set(evidence.messageId, seen + 1);
    return true;
  });
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
  rankings: Array<{ chunkId: number; relevance: number }>,
) {
  const scores = new Map(rankings.map((rank) => [rank.chunkId, rank.relevance]));
  return evidence
    .map((item) => ({ ...item, rerankScore: scores.get(item.chunkId) ?? 0 }))
    .sort(
      (left, right) =>
        (right.rerankScore ?? 0) - (left.rerankScore ?? 0) ||
        right.rrfScore - left.rrfScore,
    );
}

export async function answerKnowledgeQuestion(params: {
  question: string;
  answerModel?: string;
  rerank?: boolean;
}) {
  const question = params.question.trim();
  if (!question) throw new Error('A technical question is required.');
  if (question.length > 2_000) throw new Error('Questions are limited to 2,000 characters.');
  if (!hasOpenAIKey()) {
    throw new Error('OPENAI_API_KEY is required to generate a knowledge-base answer.');
  }

  const config = getKnowledgeConfig();
  const model = params.answerModel?.trim() || config.answerModel;
  const retrievalStartedAt = Date.now();
  let evidence = await hybridRetrieve(question, 40);
  let refined = false;
  let refinementQuery = '';

  if (evidence.length && params.rerank !== false) {
    let ranking = await rerankEvidence(question, evidence.slice(0, 30), model);
    evidence = applyReranking(evidence, ranking.rankings);
    if (ranking.missingEvidence && ranking.refinementQuery.trim()) {
      refinementQuery = ranking.refinementQuery.trim();
      const refinedEvidence = await hybridRetrieve(refinementQuery, 30);
      evidence = mergeEvidence(evidence, refinedEvidence);
      ranking = await rerankEvidence(question, evidence.slice(0, 30), model);
      evidence = applyReranking(evidence, ranking.rankings);
      refined = true;
    }
  }

  const finalEvidence = evidence
    .filter((item) => item.rerankScore === undefined || item.rerankScore >= 0.15)
    .slice(0, 10);
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
      metadata: { refined, refinementQuery },
    });
    return {
      answer,
      evidence: [],
      meta: { abstained: true, refined, refinementQuery, retrievalMs, generationMs: 0 },
    };
  }

  const generated = await generateGroundedAnswer(question, finalEvidence, model);
  const validIds = new Set(finalEvidence.map((item) => item.chunkId));
  const citedIds = Array.from(
    new Set(
      Array.from(generated.answer.matchAll(/\[KB:(\d+)\]/g), (match) => Number(match[1])),
    ),
  );
  const invalidCitations = citedIds.filter((id) => !validIds.has(id));
  const abstained = /don't have enough information in the knowledge base/i.test(
    generated.answer,
  );

  await recordQueryTrace({
    question,
    model,
    evidence: finalEvidence,
    citedIds: citedIds.filter((id) => validIds.has(id)),
    abstained,
    retrievalMs,
    generationMs: generated.generationMs,
    metadata: { refined, refinementQuery, invalidCitations },
  });
  return {
    answer: generated.answer,
    evidence: finalEvidence,
    meta: {
      abstained,
      refined,
      refinementQuery,
      retrievalMs,
      generationMs: generated.generationMs,
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
    ],
  );
}
