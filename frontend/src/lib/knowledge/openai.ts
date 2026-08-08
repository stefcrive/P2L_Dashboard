import 'server-only';

import OpenAI from 'openai';

import { getWorkspaceEnvironmentValue } from './config';
import type { EnrichmentResult, ParsedMessage, RetrievalEvidence } from './types';

let client: OpenAI | null = null;

export function hasOpenAIKey() {
  return Boolean(getWorkspaceEnvironmentValue('OPENAI_API_KEY'));
}

function getOpenAIClient() {
  const apiKey = getWorkspaceEnvironmentValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for enrichment, embeddings, and RAG answers. Parse-only ingestion works without it.',
    );
  }
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

export async function createEmbeddings(
  inputs: string[],
  model: string,
  dimensions: number,
) {
  if (!inputs.length) return [];
  const response = await getOpenAIClient().embeddings.create({
    model,
    input: inputs,
    dimensions,
    encoding_format: 'float',
  });
  return [...response.data]
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
}

export async function extractImageKnowledge(
  buffer: Buffer,
  mimeType: string,
  sourceName: string,
) {
  const model =
    getWorkspaceEnvironmentValue('OPENAI_VISION_MODEL') ||
    getWorkspaceEnvironmentValue('OPENAI_MODEL') ||
    'gpt-5.6-sol';
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Convert a laboratory image into faithful searchable source text.
Transcribe every legible word, number, unit, label, table cell, handwritten annotation, and instrument message.
Then describe relevant visual evidence such as equipment state, plots, sample labels, damage, connections, or warning indicators.
Preserve uncertainty and mark illegible areas explicitly. Do not infer facts that are not visible.
Use concise Markdown with sections titled Transcription and Visual evidence.`,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Extract searchable knowledge from ${sourceName}.`,
          },
          {
            type: 'input_image',
            image_url: `data:${mimeType};base64,${buffer.toString('base64')}`,
            detail: 'original',
          },
        ],
      },
    ],
    reasoning: { effort: 'low' },
    text: { verbosity: 'medium' },
  });
  const text = response.output_text.trim();
  if (!text) throw new Error('The image model returned no extractable content.');
  return text;
}

const enrichmentSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stableId: { type: 'string' },
          relevance: {
            type: 'string',
            enum: ['technical', 'administrative', 'mixed', 'unknown'],
          },
          summary: { type: 'string' },
          products: { type: 'array', items: { type: 'string' } },
          components: { type: 'array', items: { type: 'string' } },
          technologies: { type: 'array', items: { type: 'string' } },
          methods: { type: 'array', items: { type: 'string' } },
          isotopes: { type: 'array', items: { type: 'string' } },
          errorCodes: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'stableId',
          'relevance',
          'summary',
          'products',
          'components',
          'technologies',
          'methods',
          'isotopes',
          'errorCodes',
          'warnings',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export async function enrichMessageBatch(messages: ParsedMessage[], model: string) {
  if (!messages.length) return new Map<string, EnrichmentResult>();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `You extract metadata from archived laboratory analyst messages.
Use only the supplied text. Never add a product, procedure, causal claim, or fact that is not explicit.
The summary is a compact index aid, not evidence, and must preserve uncertainty.
Classify administrative-only messages as administrative. Put ambiguity or apparent truncation in warnings.
Personal contact details are already redacted. Return exactly one item for each stableId.`,
    input: messages.map((message) => ({
      role: 'user' as const,
      content: [
        `stableId: ${message.stableId}`,
        `subject: ${message.subjectNormalized || '(blank)'}`,
        `date: ${message.dateIso ?? message.dateRaw}`,
        `text:\n${message.cleanText.slice(0, 7_000)}`,
      ].join('\n'),
    })),
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'laboratory_message_enrichment',
        strict: true,
        schema: enrichmentSchema,
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as { items: Array<EnrichmentResult & {
    stableId: string;
  }> };
  return new Map(
    parsed.items.map(({ stableId, ...result }) => [stableId, result]),
  );
}

const rerankSchema = {
  type: 'object',
  properties: {
    rankings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chunkId: { type: 'integer' },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['chunkId', 'relevance'],
        additionalProperties: false,
      },
    },
    missingEvidence: { type: 'boolean' },
    refinementQuery: { type: 'string' },
  },
  required: ['rankings', 'missingEvidence', 'refinementQuery'],
  additionalProperties: false,
} as const;

export async function rerankEvidence(
  question: string,
  evidence: RetrievalEvidence[],
  model: string,
) {
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Rerank retrieved laboratory evidence for the question.
Score relevance only; do not answer. Exact model names, error codes, versions, and dates matter.
Set missingEvidence true only when the candidates cannot support a grounded answer.
If evidence is missing, provide one short keyword-oriented refinement query; otherwise return an empty string.`,
    input: [
      `Question: ${question}`,
      ...evidence.map(
        (item) =>
          `[KB:${item.chunkId}] ${item.subject}\n${item.content.slice(0, 1_600)}`,
      ),
    ].join('\n\n'),
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'knowledge_reranking',
        strict: true,
        schema: rerankSchema,
      },
    },
  });
  return JSON.parse(response.output_text) as {
    rankings: Array<{ chunkId: number; relevance: number }>;
    missingEvidence: boolean;
    refinementQuery: string;
  };
}

export async function generateGroundedAnswer(
  question: string,
  evidence: RetrievalEvidence[],
  model: string,
) {
  const evidenceText = evidence
    .map(
      (item) =>
        `[KB:${item.chunkId}]
Source: ${item.sourceName}, lines ${item.startLine}-${item.endLine}
Subject: ${item.subject || '(no subject)'}
Analyst: ${item.author}
Date: ${item.messageDate ?? 'unknown'}
Evidence:
${item.content}`,
    )
    .join('\n\n---\n\n');

  const startedAt = Date.now();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `You answer technical laboratory questions from retrieved archival evidence.
Treat the supplied evidence as the only factual source. Do not use unstated general knowledge.
Cite every material claim immediately with one or more exact chunk citations such as [KB:123].
Distinguish direct evidence from a cautious synthesis across sources.
Call out conflicting instructions, instrument versions, and dates instead of silently choosing one.
If the evidence is insufficient, say "I don't have enough information in the knowledge base" and specify what is missing.
Never cite a chunk that does not support the claim. Do not create a bibliography; evidence cards are shown separately.
Answer in the user's language and keep operational warnings visible.`,
    input: `Question:\n${question}\n\nRetrieved evidence:\n${evidenceText}`,
    reasoning: { effort: 'medium' },
    text: { verbosity: 'medium' },
  });
  return {
    answer: response.output_text.trim(),
    generationMs: Date.now() - startedAt,
  };
}
