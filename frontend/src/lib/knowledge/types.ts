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

export interface ParsedVisualAsset {
  stableId: string;
  pageNumber: number;
  kind: 'chart' | 'diagram' | 'figure' | 'photo' | 'table' | 'other';
  caption: string;
  description: string;
  altText: string;
  storagePath: string;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
  bbox: Record<string, unknown>;
  extractionModel: string;
  promptVersion: string;
  confidence: number | null;
  metadata: Record<string, unknown>;
}

export interface VisualReference {
  id: number;
  pageNumber: number;
  kind: string;
  caption: string;
  description: string;
  altText: string;
  width: number;
  height: number;
  bbox: Record<string, unknown>;
  imageUrl: string;
  sourceUrl: string;
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
  engineId?: number | null;
  mode: IngestionMode;
  enrichmentModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  technicalReviewEnabled: boolean;
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
  visual?: VisualReference | null;
}

export interface KnowledgeTraceSearch {
  query: string;
  mode: 'hybrid' | 'text' | 'semantic';
}

export interface KnowledgeTraceRound {
  round: number;
  candidateCount: number;
  topChunkIds?: number[];
  sufficientEvidence?: boolean;
  directAnswer?: boolean;
  confidence?: number;
  missingFacts: string[];
  followUpSearches: KnowledgeTraceSearch[];
  neighborChunkIds: number[];
  addedChunkIds: number[];
  rationale?: string;
  error?: string;
}

export interface KnowledgeRetrievalTrace {
  mode: 'thinking';
  initialQueries: string[];
  queries: string[];
  initialCandidateCount: number;
  finalEvidenceCount: number;
  rounds: KnowledgeTraceRound[];
  stopReason: string;
  retrievalMs: number;
  generationMs: number;
  verificationMs: number;
  verificationSupported: boolean | null;
  warnings: string[];
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
