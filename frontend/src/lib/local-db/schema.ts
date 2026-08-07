export const LOCAL_APP_SCHEMA_VERSION = 4;

export const LOCAL_APP_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS app_local;

CREATE TABLE IF NOT EXISTS app_local.schema_migrations (
  version integer PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  folder_slug text NOT NULL UNIQUE,
  first_seen_year integer,
  last_seen_year integer,
  total_documents integer NOT NULL DEFAULT 0 CHECK (total_documents >= 0),
  categories text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_details text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS tax_id text;

CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  relative_path text NOT NULL UNIQUE,
  absolute_path text NOT NULL,
  year integer,
  extension text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  inferred_document_number text,
  inferred_document_date date,
  file_size_bytes bigint NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  mime_type text,
  content_sha256 text,
  content bytea,
  storage_origin text NOT NULL DEFAULT 'folder'
    CHECK (storage_origin IN ('folder', 'upload')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.client_credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('spreadsheet', 'manual')),
  source_document_id uuid REFERENCES public.client_documents(id) ON DELETE SET NULL,
  source_relative_path text,
  source_sheet text NOT NULL DEFAULT '',
  source_row integer,
  event_type text NOT NULL DEFAULT 'adjustment'
    CHECK (event_type IN ('analysis', 'credit_topup', 'adjustment')),
  event_date date,
  analyses_count numeric,
  equipment text,
  unit_cost numeric,
  amount numeric,
  balance_before numeric,
  balance_after numeric,
  comment text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.materials_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_key text NOT NULL UNIQUE,
  name text NOT NULL,
  part_number text,
  description text,
  material_type text NOT NULL DEFAULT 'other',
  equipment text,
  quantity_text text,
  suggested_stock numeric,
  current_stock numeric,
  minimum_stock numeric,
  unit text,
  supplier_reference text,
  source_file text NOT NULL,
  source_sheet text,
  source_path text NOT NULL,
  notes text,
  availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'low_stock', 'out_of_stock', 'on_order', 'unavailable')),
  unit_cost numeric(14, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (char_length(currency) = 3),
  storage_location text,
  catalog_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.material_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials_inventory(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  amount numeric NOT NULL,
  previous_stock numeric,
  new_stock numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  contact_name text,
  email text,
  phone text,
  website text,
  categories text[] NOT NULL DEFAULT '{}',
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_documents
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS content bytea,
  ADD COLUMN IF NOT EXISTS storage_origin text NOT NULL DEFAULT 'folder'
    CHECK (storage_origin IN ('folder', 'upload'));

ALTER TABLE public.client_credit_events
  ADD COLUMN IF NOT EXISTS equipment text;

UPDATE public.client_credit_events
SET event_type = 'adjustment'
WHERE event_type = 'payment';

ALTER TABLE public.client_credit_events
  DROP CONSTRAINT IF EXISTS client_credit_events_event_type_check;

ALTER TABLE public.client_credit_events
  ADD CONSTRAINT client_credit_events_event_type_check
  CHECK (event_type IN ('analysis', 'credit_topup', 'adjustment'));

ALTER TABLE public.materials_inventory
  ADD COLUMN IF NOT EXISTS availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'low_stock', 'out_of_stock', 'on_order', 'unavailable')),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14, 2)
    CHECK (unit_cost IS NULL OR unit_cost >= 0),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL'
    CHECK (char_length(currency) = 3),
  ADD COLUMN IF NOT EXISTS storage_location text,
  ADD COLUMN IF NOT EXISTS catalog_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.provider_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materials_inventory(id) ON DELETE CASCADE,
  supplier_sku text,
  unit_price numeric(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  preferred boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, material_id)
);

CREATE TABLE IF NOT EXISTS public.material_purchase_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  provider_name text,
  provider_contact text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.material_purchase_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_list_id uuid NOT NULL REFERENCES public.material_purchase_lists(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.materials_inventory(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 1 CHECK (quantity > 0),
  note text,
  material_name_snapshot text NOT NULL,
  part_number_snapshot text,
  material_type_snapshot text,
  unit_snapshot text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.client_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  result_code text NOT NULL UNIQUE,
  sample_reference text NOT NULL,
  analysis_type text NOT NULL,
  measured_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'validated', 'released', 'void')),
  value numeric,
  unit text,
  uncertainty numeric CHECK (uncertainty IS NULL OR uncertainty >= 0),
  method text,
  instrument text,
  source_document_id uuid REFERENCES public.client_documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_result_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL UNIQUE
    REFERENCES public.client_documents(id) ON DELETE CASCADE,
  analysis_series text NOT NULL DEFAULT 'Stable C & O isotopes',
  result_date date,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  identifier_1_count integer NOT NULL DEFAULT 0 CHECK (identifier_1_count >= 0),
  species_count integer NOT NULL DEFAULT 0 CHECK (species_count >= 0),
  status text NOT NULL DEFAULT 'parsed'
    CHECK (status IN ('parsed', 'warning', 'error')),
  import_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.result_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_file_id uuid NOT NULL
    REFERENCES public.client_result_files(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  identifier_1 text NOT NULL,
  identifier_2 text NOT NULL,
  identifier_2_order numeric,
  species text,
  d13c_value numeric,
  d13c_uncertainty numeric,
  d18o_value numeric,
  d18o_uncertainty numeric,
  corrected_d13c numeric,
  corrected_d18o numeric,
  method text,
  observation text,
  source_sheet text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_file_id, source_sheet, source_row)
);

CREATE TABLE IF NOT EXISTS public.client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (char_length(currency) = 3),
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date IS NULL OR due_date >= issue_date)
);

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  issuer_details text NOT NULL DEFAULT '',
  national_payment_details text NOT NULL DEFAULT '',
  international_payment_details text NOT NULL DEFAULT '',
  default_payment_instructions text NOT NULL DEFAULT 'both'
    CHECK (default_payment_instructions IN ('national', 'international', 'both')),
  default_currency text NOT NULL DEFAULT 'BRL'
    CHECK (char_length(default_currency) = 3),
  default_language text NOT NULL DEFAULT 'en'
    CHECK (default_language IN ('en', 'pt')),
  footer_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

INSERT INTO public.invoice_settings (id, issuer_details, footer_note)
VALUES (
  'default',
  E'Laboratório de Paleoceanografia e Paleoclimatologia (P2L)\\nEscola de Artes, Ciências e Humanidades\\nUniversidade de São Paulo\\nSão Paulo, Brazil',
  'P2L · EACH-USP · Universidade de São Paulo'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.client_invoices
  ADD COLUMN IF NOT EXISTS tax_percent numeric(7, 3) NOT NULL DEFAULT 0
    CHECK (tax_percent >= 0),
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'pt')),
  ADD COLUMN IF NOT EXISTS payment_instructions text NOT NULL DEFAULT 'both'
    CHECK (payment_instructions IN ('national', 'international', 'both')),
  ADD COLUMN IF NOT EXISTS client_name_snapshot text,
  ADD COLUMN IF NOT EXISTS client_details_snapshot text,
  ADD COLUMN IF NOT EXISTS service_description text,
  ADD COLUMN IF NOT EXISTS additional_info text,
  ADD COLUMN IF NOT EXISTS issuer_details text,
  ADD COLUMN IF NOT EXISTS national_payment_details text,
  ADD COLUMN IF NOT EXISTS international_payment_details text,
  ADD COLUMN IF NOT EXISTS pdf_document_id uuid
    REFERENCES public.client_documents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.equipment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code text NOT NULL UNIQUE,
  name text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  location text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'service_due', 'out_of_service', 'retired')),
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  last_service_at timestamptz,
  next_service_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_book_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL DEFAULT 'general'
    CHECK (entry_type IN ('general', 'maintenance', 'calibration', 'incident', 'quality_control')),
  title text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  asset_id uuid REFERENCES public.equipment_assets(id) ON DELETE SET NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'failed', 'cancelled')),
  performed_by text,
  description text,
  next_due_at timestamptz,
  attachment_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.backup_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name text NOT NULL,
  backup_type text NOT NULL DEFAULT 'database'
    CHECK (backup_type IN ('database', 'documents', 'instrument', 'configuration', 'full')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'verified')),
  destination text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_credit_events_source_unique_idx
  ON public.client_credit_events (
    client_id, source_type, source_relative_path, source_sheet, source_row
  );
CREATE INDEX IF NOT EXISTS client_documents_client_idx ON public.client_documents (client_id);
CREATE INDEX IF NOT EXISTS client_documents_year_idx ON public.client_documents (year);
CREATE INDEX IF NOT EXISTS client_documents_client_created_idx
  ON public.client_documents (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS materials_inventory_provider_idx
  ON public.materials_inventory (provider_id);
CREATE INDEX IF NOT EXISTS client_credit_events_client_date_idx
  ON public.client_credit_events (client_id, event_date DESC);
CREATE INDEX IF NOT EXISTS materials_name_idx ON public.materials_inventory (name);
CREATE INDEX IF NOT EXISTS materials_type_idx ON public.materials_inventory (material_type);
CREATE INDEX IF NOT EXISTS material_stock_material_idx ON public.material_stock_movements (material_id);
CREATE INDEX IF NOT EXISTS material_purchase_items_list_idx
  ON public.material_purchase_list_items (purchase_list_id);
CREATE INDEX IF NOT EXISTS providers_status_name_idx ON public.providers (status, name);
CREATE INDEX IF NOT EXISTS provider_materials_provider_idx ON public.provider_materials (provider_id);
CREATE INDEX IF NOT EXISTS provider_materials_material_idx ON public.provider_materials (material_id);
CREATE INDEX IF NOT EXISTS client_results_client_status_idx
  ON public.client_results (client_id, status, measured_at DESC);
CREATE INDEX IF NOT EXISTS client_result_files_client_date_idx
  ON public.client_result_files (client_id, result_date DESC);
CREATE INDEX IF NOT EXISTS result_measurements_lookup_idx
  ON public.result_measurements (client_id, identifier_1, identifier_2);
CREATE INDEX IF NOT EXISTS result_measurements_species_idx
  ON public.result_measurements (species);
CREATE INDEX IF NOT EXISTS result_measurements_file_order_idx
  ON public.result_measurements (result_file_id, identifier_2_order, source_row);
CREATE INDEX IF NOT EXISTS client_invoices_client_status_idx
  ON public.client_invoices (client_id, status, due_date);
CREATE INDEX IF NOT EXISTS client_invoices_pdf_document_idx
  ON public.client_invoices (pdf_document_id);
CREATE INDEX IF NOT EXISTS client_invoices_open_due_idx
  ON public.client_invoices (due_date) WHERE status IN ('sent', 'overdue');
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS equipment_assets_provider_idx ON public.equipment_assets (provider_id);
CREATE INDEX IF NOT EXISTS equipment_assets_service_idx
  ON public.equipment_assets (status, next_service_at);
CREATE INDEX IF NOT EXISTS lab_book_asset_idx ON public.lab_book_entries (asset_id);
CREATE INDEX IF NOT EXISTS lab_book_provider_idx ON public.lab_book_entries (provider_id);
CREATE INDEX IF NOT EXISTS lab_book_occurred_idx
  ON public.lab_book_entries (entry_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS backup_records_started_idx
  ON public.backup_records (status, started_at DESC);

DROP TRIGGER IF EXISTS clients_set_updated_at ON public.clients;
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS client_documents_set_updated_at ON public.client_documents;
CREATE TRIGGER client_documents_set_updated_at BEFORE UPDATE ON public.client_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS client_credit_events_set_updated_at ON public.client_credit_events;
CREATE TRIGGER client_credit_events_set_updated_at BEFORE UPDATE ON public.client_credit_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS materials_inventory_set_updated_at ON public.materials_inventory;
CREATE TRIGGER materials_inventory_set_updated_at BEFORE UPDATE ON public.materials_inventory
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS material_purchase_lists_set_updated_at ON public.material_purchase_lists;
CREATE TRIGGER material_purchase_lists_set_updated_at BEFORE UPDATE ON public.material_purchase_lists
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS providers_set_updated_at ON public.providers;
CREATE TRIGGER providers_set_updated_at BEFORE UPDATE ON public.providers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS provider_materials_set_updated_at ON public.provider_materials;
CREATE TRIGGER provider_materials_set_updated_at BEFORE UPDATE ON public.provider_materials
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS client_results_set_updated_at ON public.client_results;
CREATE TRIGGER client_results_set_updated_at BEFORE UPDATE ON public.client_results
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS client_result_files_set_updated_at ON public.client_result_files;
CREATE TRIGGER client_result_files_set_updated_at BEFORE UPDATE ON public.client_result_files
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS client_invoices_set_updated_at ON public.client_invoices;
CREATE TRIGGER client_invoices_set_updated_at BEFORE UPDATE ON public.client_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS invoice_settings_set_updated_at ON public.invoice_settings;
CREATE TRIGGER invoice_settings_set_updated_at BEFORE UPDATE ON public.invoice_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS equipment_assets_set_updated_at ON public.equipment_assets;
CREATE TRIGGER equipment_assets_set_updated_at BEFORE UPDATE ON public.equipment_assets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS lab_book_entries_set_updated_at ON public.lab_book_entries;
CREATE TRIGGER lab_book_entries_set_updated_at BEFORE UPDATE ON public.lab_book_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS backup_records_set_updated_at ON public.backup_records;
CREATE TRIGGER backup_records_set_updated_at BEFORE UPDATE ON public.backup_records
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO app_local.schema_migrations (version, description)
VALUES (1, 'Initial Docker-free operational application database')
ON CONFLICT (version) DO NOTHING;

INSERT INTO app_local.schema_migrations (version, description)
VALUES (2, 'Persist client document content and extend editable material records')
ON CONFLICT (version) DO NOTHING;

INSERT INTO app_local.schema_migrations (version, description)
VALUES (3, 'Add structured result files, measurements, and branded invoice fields')
ON CONFLICT (version) DO NOTHING;

INSERT INTO app_local.schema_migrations (version, description)
VALUES (4, 'Add persistent invoice defaults and payment settings')
ON CONFLICT (version) DO NOTHING;
`;
