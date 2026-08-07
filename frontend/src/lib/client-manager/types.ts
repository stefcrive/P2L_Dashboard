export const DOCUMENT_CATEGORIES = [
  'quote',
  'invoice',
  'payment_slip',
  'payment_receipt',
  'credit',
  'purchase_order',
  'shipping',
  'analysis',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CREDIT_EVENT_TYPES = [
  'analysis',
  'credit_topup',
  'adjustment',
] as const;

export type CreditEventType = (typeof CREDIT_EVENT_TYPES)[number];

// Keep this list centralized so the selector can grow as lab equipment is added.
export const CREDIT_EVENT_EQUIPMENT_OPTIONS = ['Kiel IV - MAT253'] as const;

export interface ExtractedClient {
  name: string;
  folderSlug: string;
  firstSeenYear: number | null;
  lastSeenYear: number | null;
  totalDocuments: number;
  categories: DocumentCategory[];
}

export interface ExtractedDocument {
  clientName: string;
  clientFolderSlug: string;
  year: number | null;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  extension: string;
  category: DocumentCategory;
  inferredDocumentNumber: string | null;
  inferredDocumentDate: string | null;
  fileSizeBytes: number;
}

export interface ExtractedClientCreditEvent {
  clientName: string;
  clientFolderSlug: string;
  sourceRelativePath: string;
  sourceSheet: string;
  sourceRow: number;
  eventType: CreditEventType;
  eventDate: string | null;
  analysesCount: number | null;
  equipment: string | null;
  unitCost: number | null;
  amount: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  comment: string | null;
}

export interface ExtractionStats {
  totalClients: number;
  totalDocuments: number;
  totalFileSizeBytes: number;
  byCategory: Record<DocumentCategory, number>;
  byYear: Record<string, number>;
  totalCreditEvents: number;
}

export interface ExtractionSnapshot {
  sourceFolder: string;
  extractedAt: string;
  clients: ExtractedClient[];
  documents: ExtractedDocument[];
  creditEvents: ExtractedClientCreditEvent[];
  stats: ExtractionStats;
  warnings: string[];
}

export interface ClientRow {
  id: string;
  name: string;
  folder_slug: string;
  billing_details: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  first_seen_year: number | null;
  last_seen_year: number | null;
  total_documents: number;
  categories: DocumentCategory[];
  created_at: string;
  updated_at: string;
}

export interface ClientDocumentRow {
  id: string;
  client_id: string;
  file_name: string;
  relative_path: string;
  absolute_path: string;
  year: number | null;
  extension: string;
  category: DocumentCategory;
  inferred_document_number: string | null;
  inferred_document_date: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  content_sha256: string | null;
  storage_origin: 'folder' | 'upload';
  created_at: string;
  updated_at: string;
}

export type ClientCreditSourceType = 'spreadsheet' | 'manual';

export interface ClientCreditEventRow {
  id: string;
  client_id: string;
  source_type: ClientCreditSourceType;
  source_document_id: string | null;
  source_relative_path: string | null;
  source_sheet: string;
  source_row: number | null;
  event_type: CreditEventType;
  event_date: string | null;
  analyses_count: number | null;
  equipment: string | null;
  unit_cost: number | null;
  amount: number | null;
  balance_before: number | null;
  balance_after: number | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientWithDocuments extends ClientRow {
  documents: ClientDocumentRow[];
  credit_events: ClientCreditEventRow[];
  current_credit_balance: number | null;
}

export interface ClientManagerStats {
  totalClients: number;
  totalDocuments: number;
  totalStorageBytes: number;
  totalCreditEvents: number;
  clientsWithCredit: number;
  totalOutstandingCredit: number;
  totalSpentAmount: number;
  documentsByCategory: Record<DocumentCategory, number>;
  documentsByYear: Record<string, number>;
}

export interface ClientManagerDataResponse {
  source: 'local' | 'supabase' | 'filesystem';
  warnings: string[];
  availableYears: number[];
  availableCategories: DocumentCategory[];
  clients: ClientWithDocuments[];
  documents: ClientDocumentRow[];
  creditEvents: ClientCreditEventRow[];
  stats: ClientManagerStats;
}
