import 'server-only';

import OpenAI from 'openai';

import { getWorkspaceEnvironmentValue } from './config';
import type { EnrichmentResult, ParsedMessage, RetrievalEvidence } from './types';

export type AutoTriageClassification =
  | 'technical_answer'
  | 'technical_question'
  | 'technical_discussion'
  | 'mixed'
  | 'event_announcement'
  | 'job_posting'
  | 'commercial'
  | 'list_administration'
  | 'social'
  | 'empty'
  | 'unclear';

export interface AutoTriageInput {
  stableId: string;
  subject: string;
  author: string;
  content: string;
  threadContext: Array<{
    author: string;
    content: string;
  }>;
}

export interface AutoTriageResult {
  stableId: string;
  classification: AutoTriageClassification;
  recommendation: 'keep' | 'quarantine' | 'review';
  confidence: number;
  knowledgeValue: 'high' | 'medium' | 'low' | 'none';
  containsActionableTechnicalResponse: boolean;
  dependsOnThreadContext: boolean;
  rationale: string;
  technicalEvidence: string[];
}

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

const visualKnowledgeSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['chart', 'diagram', 'figure', 'photo', 'other'],
    },
    title: { type: 'string' },
    summary: { type: 'string' },
    transcription: { type: 'string' },
    keyDetails: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'kind',
    'title',
    'summary',
    'transcription',
    'keyDetails',
    'confidence',
    'warnings',
  ],
  additionalProperties: false,
} as const;

export interface VisualKnowledgeDescription {
  kind: 'chart' | 'diagram' | 'figure' | 'photo' | 'other';
  title: string;
  summary: string;
  transcription: string;
  keyDetails: string[];
  confidence: number;
  warnings: string[];
  extractionModel: string;
  promptVersion: string;
}

export async function describeKnowledgeVisual(params: {
  buffer: Buffer;
  mimeType: string;
  sourceName: string;
  pageNumber: number;
  caption: string;
}): Promise<VisualKnowledgeDescription> {
  const model =
    getWorkspaceEnvironmentValue('OPENAI_VISION_MODEL') || 'gpt-5.6-luna';
  const promptVersion = 'scientific_visual_v1';
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Extract searchable evidence from one scientific-document visual.
Describe only what is visible. Preserve uncertainty. Transcribe legible labels, axes, legends, units, annotations, and values that materially help retrieval. For charts, state trends and series only when visible; never estimate hidden or unreadable values. Keep the summary compact because it will be embedded for retrieval.`,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Source: ${params.sourceName}\nPDF page: ${params.pageNumber}\nPrinted caption: ${params.caption || '(none)'}`,
          },
          {
            type: 'input_image',
            image_url: `data:${params.mimeType};base64,${params.buffer.toString('base64')}`,
            detail: 'high',
          },
        ],
      },
    ],
    reasoning: { effort: 'none' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'scientific_visual_knowledge',
        strict: true,
        schema: visualKnowledgeSchema,
      },
    },
  });
  const parsed = JSON.parse(response.output_text) as Omit<
    VisualKnowledgeDescription,
    'extractionModel' | 'promptVersion'
  >;
  return {
    ...parsed,
    extractionModel: model,
    promptVersion,
  };
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

const autoTriageSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stableId: { type: 'string' },
          classification: {
            type: 'string',
            enum: [
              'technical_answer',
              'technical_question',
              'technical_discussion',
              'mixed',
              'event_announcement',
              'job_posting',
              'commercial',
              'list_administration',
              'social',
              'empty',
              'unclear',
            ],
          },
          recommendation: {
            type: 'string',
            enum: ['keep', 'quarantine', 'review'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          knowledgeValue: {
            type: 'string',
            enum: ['high', 'medium', 'low', 'none'],
          },
          containsActionableTechnicalResponse: { type: 'boolean' },
          dependsOnThreadContext: { type: 'boolean' },
          rationale: { type: 'string' },
          technicalEvidence: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'stableId',
          'classification',
          'recommendation',
          'confidence',
          'knowledgeValue',
          'containsActionableTechnicalResponse',
          'dependsOnThreadContext',
          'rationale',
          'technicalEvidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

async function requestAutoTriageItems(
  messages: AutoTriageInput[],
  model: string
) {
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Classify archived ISOGEOCHEM mailing-list messages for a laboratory knowledge base.
Protect recall of useful technical knowledge. A concrete answer, troubleshooting observation, procedure, parameter, part number, calibration detail, failure mode, workaround, or instrument experience should be kept. Technical questions and substantive technical discussions are also useful.
Quarantine only clearly administrative material such as event promotion, job advertisements, commercial promotion without unique technical evidence, list administration, social chatter, or empty content.
Use mixed or review when useful technical content is embedded in administrative material or when context is insufficient. Never infer technical facts. technicalEvidence must contain only short paraphrases of evidence explicitly present in the message. Return exactly one item for every stableId.`,
    input: messages.map((message) => ({
      role: 'user' as const,
      content: [
        `stableId: ${message.stableId}`,
        `subject: ${message.subject || '(blank)'}`,
        `author: ${message.author || '(unknown)'}`,
        `message:\n${message.content.slice(0, 5_500) || '(empty)'}`,
        message.threadContext.length
          ? `nearby thread context (context only; classify the message above):\n${message.threadContext
              .map(
                (item, index) =>
                  `[${index + 1}] ${item.author || '(unknown)'}: ${item.content.slice(0, 1_200)}`
              )
              .join('\n\n')}`
          : 'nearby thread context: (none available)',
      ].join('\n'),
    })),
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'isogeochem_review_triage',
        strict: true,
        schema: autoTriageSchema,
      },
    },
  });
  const parsed = JSON.parse(response.output_text) as {
    items: AutoTriageResult[];
  };
  return parsed.items;
}

export async function autoTriageReviewBatch(
  messages: AutoTriageInput[],
  model = 'gpt-5.6-luna'
) {
  if (!messages.length) return new Map<string, AutoTriageResult>();

  const expectedIds = new Set(messages.map((message) => message.stableId));
  if (expectedIds.size !== messages.length) {
    throw new Error('Auto-triage received duplicate message identifiers.');
  }

  const batchItems = await requestAutoTriageItems(messages, model);
  const results = new Map<string, AutoTriageResult>();
  for (const item of batchItems) {
    if (expectedIds.has(item.stableId) && !results.has(item.stableId)) {
      results.set(item.stableId, item);
    }
  }

  const missing = messages.filter((message) => !results.has(message.stableId));
  for (const message of missing) {
    const retryItems = await requestAutoTriageItems([message], model);
    if (retryItems.length !== 1) {
      throw new Error(
        `Auto-triage returned ${retryItems.length} decisions while retrying message ${message.stableId}.`
      );
    }
    results.set(message.stableId, {
      ...retryItems[0],
      stableId: message.stableId,
    });
  }

  return results;
}

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
    sufficientEvidence: { type: 'boolean' },
    directAnswer: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missingFacts: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    followUpSearches: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          mode: { type: 'string', enum: ['hybrid', 'text', 'semantic'] },
        },
        required: ['query', 'mode'],
        additionalProperties: false,
      },
    },
    neighborChunkIds: {
      type: 'array',
      items: { type: 'integer' },
      maxItems: 4,
    },
    rationale: { type: 'string' },
  },
  required: [
    'rankings',
    'sufficientEvidence',
    'directAnswer',
    'confidence',
    'missingFacts',
    'followUpSearches',
    'neighborChunkIds',
    'rationale',
  ],
  additionalProperties: false,
} as const;

export async function rerankEvidence(
  question: string,
  evidence: RetrievalEvidence[],
  model: string,
) {
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Act as the evidence critic and search controller for a laboratory knowledge base; do not answer the question.
Rank every useful candidate by relevance. Exact model names, error codes, versions, dates, chemical symbols, and uncertainty matter.
Set directAnswer true only when at least one passage explicitly answers the question's core request. directAnswer implies sufficientEvidence.
Set sufficientEvidence true when the candidates can support a substantive grounded answer, including a careful synthesis. Do not demand details the user did not ask for.
When evidence is insufficient or conflicting, list the specific missing facts and provide focused follow-up searches. Treat references to manuals, guides, document titles, sections, or named procedures as leads: search those exact names and request neighboring chunks when they may contain the procedure. Select text for exact terminology, semantic for paraphrases, or hybrid when both are useful.
Request neighborChunkIds only from the supplied KB identifiers when a relevant passage appears truncated and its immediately adjacent passage may complete it.
Return no follow-up searches or neighbor IDs when the evidence is already sufficient. Keep rationale to one concise sentence.`,
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
    sufficientEvidence: boolean;
    directAnswer: boolean;
    confidence: number;
    missingFacts: string[];
    followUpSearches: Array<{
      query: string;
      mode: 'hybrid' | 'text' | 'semantic';
    }>;
    neighborChunkIds: number[];
    rationale: string;
  };
}

const retrievalPlanSchema = {
  type: 'object',
  properties: {
    correctedQuestion: { type: 'string' },
    keywordQuery: { type: 'string' },
  },
  required: ['correctedQuestion', 'keywordQuery'],
  additionalProperties: false,
} as const;

export async function planKnowledgeRetrieval(
  question: string,
  model: string
) {
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Prepare a technical knowledge-base question for retrieval; do not answer it.
Correct clear spelling mistakes while preserving the user's meaning. Preserve exact model numbers, error codes, isotope notation, chemical symbols, dates, and quoted phrases.
correctedQuestion should be a concise natural-language correction of the original.
keywordQuery should contain only the most discriminating source terms and high-confidence standard synonyms or expanded abbreviations. Never add a factual claim or speculative diagnosis.`,
    input: question,
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'knowledge_retrieval_plan',
        strict: true,
        schema: retrievalPlanSchema,
      },
    },
  });
  return JSON.parse(response.output_text) as {
    correctedQuestion: string;
    keywordQuery: string;
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
Source: ${item.sourceName}, ${
          item.visual
            ? `${item.visual.kind} on PDF page ${item.visual.pageNumber}`
            : `lines ${item.startLine}-${item.endLine}`
        }
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
Format mathematical notation as LaTeX: use $...$ for inline notation and a blank-line-delimited $$...$$ block for a standalone equation. Never use square brackets or parentheses as math delimiters. Keep [KB:<id>] citations outside the math delimiters.
Distinguish direct evidence from a cautious synthesis across sources.
Call out conflicting instructions, instrument versions, and dates instead of silently choosing one.
If no substantive answer is supported, begin with "I don't have enough information in the knowledge base" and specify what is missing. If a substantive answer is supported but details remain unknown, answer first and describe those limits without using that abstention phrase.
Never cite a chunk that does not support the claim. Do not create a bibliography; evidence cards are shown separately.
When visual evidence supports the answer, cite its KB chunk normally; the interface will display the extracted chart or figure with the citation.
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

const answerVerificationSchema = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    verifiedAnswer: { type: 'string' },
    unsupportedClaims: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 8,
    },
    rationale: { type: 'string' },
  },
  required: [
    'supported',
    'verifiedAnswer',
    'unsupportedClaims',
    'rationale',
  ],
  additionalProperties: false,
} as const;

export async function verifyGroundedAnswer(
  question: string,
  draftAnswer: string,
  evidence: RetrievalEvidence[],
  model: string
) {
  const startedAt = Date.now();
  const response = await getOpenAIClient().responses.create({
    model,
    instructions: `Verify a drafted knowledge-base answer claim by claim against the supplied evidence.
Treat the evidence as the only factual source. Every material factual claim must have an adjacent [KB:<id>] citation whose passage directly supports it.
Preserve a correct draft. Otherwise, verifiedAnswer must remove or qualify unsupported claims and repair citations using only supplied KB identifiers. Never introduce a new factual claim.
Preserve or repair mathematical notation as LaTeX using $...$ inline and a blank-line-delimited $$...$$ block for standalone equations. Keep [KB:<id>] citations outside the math delimiters.
An explicit limitation about information absent from the evidence does not require a citation. Keep the answer in the user's language and do not add a bibliography.
supported is true only when verifiedAnswer contains no unsupported material claim. Keep rationale concise.`,
    input: [
      `Question:\n${question}`,
      `Draft answer:\n${draftAnswer}`,
      ...evidence.map(
        (item) =>
          `[KB:${item.chunkId}] ${item.subject}\n${item.content.slice(0, 2_000)}`
      ),
    ].join('\n\n---\n\n'),
    reasoning: { effort: 'low' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'knowledge_answer_verification',
        strict: true,
        schema: answerVerificationSchema,
      },
    },
  });
  return {
    ...(JSON.parse(response.output_text) as {
      supported: boolean;
      verifiedAnswer: string;
      unsupportedClaims: string[];
      rationale: string;
    }),
    verificationMs: Date.now() - startedAt,
  };
}
