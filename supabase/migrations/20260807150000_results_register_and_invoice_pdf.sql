-- Structured result-file register and branded invoice issuing.

alter table public.clients
  add column if not exists billing_details text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists tax_id text;

create table if not exists public.client_result_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_document_id uuid not null unique
    references public.client_documents(id) on delete cascade,
  analysis_series text not null default 'Stable C & O isotopes',
  result_date date,
  row_count integer not null default 0 check (row_count >= 0),
  identifier_1_count integer not null default 0 check (identifier_1_count >= 0),
  species_count integer not null default 0 check (species_count >= 0),
  status text not null default 'parsed'
    check (status in ('parsed', 'warning', 'error')),
  import_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.result_measurements (
  id uuid primary key default gen_random_uuid(),
  result_file_id uuid not null
    references public.client_result_files(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  identifier_1 text not null,
  identifier_2 text not null,
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
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  created_at timestamptz not null default now(),
  unique (result_file_id, source_sheet, source_row)
);

alter table public.client_invoices
  add column if not exists tax_percent numeric(7, 3) not null default 0
    check (tax_percent >= 0),
  add column if not exists language text not null default 'en'
    check (language in ('en', 'pt')),
  add column if not exists payment_instructions text not null default 'both'
    check (payment_instructions in ('national', 'international', 'both')),
  add column if not exists client_name_snapshot text,
  add column if not exists client_details_snapshot text,
  add column if not exists service_description text,
  add column if not exists additional_info text,
  add column if not exists issuer_details text,
  add column if not exists national_payment_details text,
  add column if not exists international_payment_details text,
  add column if not exists pdf_document_id uuid
    references public.client_documents(id) on delete set null;

create index if not exists client_result_files_client_date_idx
  on public.client_result_files (client_id, result_date desc);
create index if not exists result_measurements_lookup_idx
  on public.result_measurements (client_id, identifier_1, identifier_2);
create index if not exists result_measurements_species_idx
  on public.result_measurements (species);
create index if not exists result_measurements_file_order_idx
  on public.result_measurements (result_file_id, identifier_2_order, source_row);
create index if not exists client_invoices_pdf_document_idx
  on public.client_invoices (pdf_document_id);

drop trigger if exists client_result_files_set_updated_at
  on public.client_result_files;
create trigger client_result_files_set_updated_at
before update on public.client_result_files
for each row execute function public.set_updated_at();

alter table public.client_result_files enable row level security;
alter table public.result_measurements enable row level security;

revoke all on public.client_result_files from anon, authenticated;
revoke all on public.result_measurements from anon, authenticated;
grant all on public.client_result_files to service_role;
grant all on public.result_measurements to service_role;

