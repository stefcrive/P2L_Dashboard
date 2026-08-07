import 'server-only';

export const resourceNames = [
  'clients',
  'providers',
  'results',
  'invoices',
  'assets',
  'lab-book',
  'backups',
] as const;

export type ResourceName = (typeof resourceNames)[number];

type ResourceConfig = {
  table: string;
  select: string;
  orderColumn: string;
  ascending?: boolean;
  readOnly?: boolean;
  required: string[];
  writable: string[];
};

export const resourceConfigs: Record<ResourceName, ResourceConfig> = {
  clients: {
    table: 'clients',
    select:
      'id, name, folder_slug, billing_details, email, phone, tax_id, first_seen_year, last_seen_year, total_documents',
    orderColumn: 'name',
    ascending: true,
    readOnly: true,
    required: [],
    writable: [],
  },
  providers: {
    table: 'providers',
    select:
      'id, name, contact_name, email, phone, website, categories, lead_time_days, status, notes, created_at, updated_at',
    orderColumn: 'name',
    ascending: true,
    required: ['name'],
    writable: [
      'name',
      'contact_name',
      'email',
      'phone',
      'website',
      'categories',
      'lead_time_days',
      'status',
      'notes',
    ],
  },
  results: {
    table: 'client_results',
    select:
      'id, client_id, result_code, sample_reference, analysis_type, measured_at, status, value, unit, uncertainty, method, instrument, notes, created_at, updated_at, client:clients(id, name)',
    orderColumn: 'created_at',
    required: ['client_id', 'result_code', 'sample_reference', 'analysis_type'],
    writable: [
      'client_id',
      'result_code',
      'sample_reference',
      'analysis_type',
      'measured_at',
      'status',
      'value',
      'unit',
      'uncertainty',
      'method',
      'instrument',
      'source_document_id',
      'notes',
    ],
  },
  invoices: {
    table: 'client_invoices',
    select:
      'id, client_id, invoice_number, issue_date, due_date, status, subtotal, tax_amount, tax_percent, total_amount, currency, paid_at, notes, language, payment_instructions, pdf_document_id, created_at, updated_at, client:clients(id, name)',
    orderColumn: 'issue_date',
    required: ['client_id', 'invoice_number', 'issue_date'],
    writable: [
      'client_id',
      'invoice_number',
      'issue_date',
      'due_date',
      'status',
      'subtotal',
      'tax_amount',
      'total_amount',
      'currency',
      'paid_at',
      'notes',
    ],
  },
  assets: {
    table: 'equipment_assets',
    select:
      'id, asset_code, name, manufacturer, model, serial_number, location, status, provider_id, last_service_at, next_service_at, notes, created_at, updated_at, provider:providers(id, name)',
    orderColumn: 'name',
    ascending: true,
    required: ['asset_code', 'name'],
    writable: [
      'asset_code',
      'name',
      'manufacturer',
      'model',
      'serial_number',
      'location',
      'status',
      'provider_id',
      'last_service_at',
      'next_service_at',
      'notes',
    ],
  },
  'lab-book': {
    table: 'lab_book_entries',
    select:
      'id, entry_type, title, occurred_at, asset_id, provider_id, status, performed_by, description, next_due_at, attachment_path, created_at, updated_at, asset:equipment_assets(id, asset_code, name), provider:providers(id, name)',
    orderColumn: 'occurred_at',
    required: ['title', 'entry_type', 'occurred_at'],
    writable: [
      'entry_type',
      'title',
      'occurred_at',
      'asset_id',
      'provider_id',
      'status',
      'performed_by',
      'description',
      'next_due_at',
      'attachment_path',
    ],
  },
  backups: {
    table: 'backup_records',
    select:
      'id, system_name, backup_type, started_at, completed_at, status, destination, size_bytes, verified, notes, created_at, updated_at',
    orderColumn: 'started_at',
    required: ['system_name', 'backup_type', 'started_at'],
    writable: [
      'system_name',
      'backup_type',
      'started_at',
      'completed_at',
      'status',
      'destination',
      'size_bytes',
      'verified',
      'notes',
    ],
  },
};

export function isResourceName(value: string): value is ResourceName {
  return resourceNames.includes(value as ResourceName);
}

export function sanitizeResourcePayload(
  resource: ResourceName,
  payload: Record<string, unknown>,
  requireMandatoryFields = true
) {
  const config = resourceConfigs[resource];
  const sanitized: Record<string, unknown> = {};

  for (const key of config.writable) {
    if (!(key in payload)) continue;
    const value = payload[key];
    sanitized[key] =
      typeof value === 'string' && value.trim() === '' ? null : value;
  }

  const missing = requireMandatoryFields
    ? config.required.filter((key) => {
        const value = sanitized[key];
        return value === undefined || value === null || value === '';
      })
    : [];

  if (missing.length > 0) {
    throw new Error(`Complete the required fields: ${missing.join(', ')}.`);
  }

  return sanitized;
}
