export const INGESTION_STAGES = [
  'queued',
  'parse',
  'clean',
  'enrich',
  'embed',
  'index',
  'complete',
] as const;

export type IngestionStage = (typeof INGESTION_STAGES)[number];
export type IngestionMode = 'parse_only' | 'indexed' | 'enriched';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface KnowledgeConfig {
  repositoryRoot: string;
  databasePath: string;
  defaultSourcePath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  enrichmentModel: string;
  answerModel: string;
}

export interface ParsedMessage {
  sourceOrdinal: number;
  stableId: string;
  subjectRaw: string;
  subjectNormalized: string;
  threadKey: string;
  authorRaw: string;
  authorDisplay: string;
  authorEmailHash: string | null;
  dateRaw: string;
  dateIso: string | null;
  bodyRaw: string;
  bodyNew: string;
  quotedHistory: string;
  signatureText: string;
  cleanText: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  bodyStartLine: number;
  endLine: number;
  warnings: string[];
  deterministicMetadata: Record<string, unknown>;
}

export interface KnowledgeChunk {
  chunkIndex: number;
  content: string;
  contextualContent: string;
  contentSha256: string;
  approxTokens: number;
  startOffset: number;
  endOffset: number;
  metadata: Record<string, unknown>;
}

export interface EnrichmentResult {
  relevance: 'technical' | 'administrative' | 'mixed' | 'unknown';
  summary: string;
  products: string[];
  components: string[];
  technologies: string[];
  methods: string[];
  isotopes: string[];
  errorCodes: string[];
  warnings: string[];
}

export interface IngestionJobOptions {
  sourcePath: string;
  mode: IngestionMode;
  enrichmentModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkTargetTokens: number;
  chunkOverlapTokens: number;
}

export interface RetrievalEvidence {
  chunkId: number;
  messageId: number;
  sourceId: number;
  sourcePath: string;
  sourceName: string;
  subject: string;
  author: string;
  messageDate: string | null;
  startLine: number;
  endLine: number;
  content: string;
  metadata: Record<string, unknown>;
  semanticRank: number | null;
  keywordRank: number | null;
  exactRank: number | null;
  rrfScore: number;
  rerankScore?: number;
}

export interface KnowledgeOverview {
  database: {
    engine: string;
    path: string;
    portableTarget: string;
  };
  counts: {
    sources: number;
    messages: number;
    chunks: number;
    embeddedChunks: number;
    activeJobs: number;
  };
  jobs: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  defaults: {
    sourcePath: string;
    enrichmentModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
    answerModel: string;
  };
}
