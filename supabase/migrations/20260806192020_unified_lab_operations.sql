-- Unified local laboratory operations model.
-- The application accesses these tables only through server-side Next.js routes
-- using the local service role. Browser roles intentionally receive no grants.

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  email text,
  phone text,
  website text,
  categories text[] not null default '{}',
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_materials (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  material_id uuid not null references public.materials_inventory(id) on delete cascade,
  supplier_sku text,
  unit_price numeric(12, 2) check (unit_price is null or unit_price >= 0),
  currency text not null default 'EUR'
    check (char_length(currency) = 3),
  preferred boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, material_id)
);

create table if not exists public.client_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  result_code text not null unique,
  sample_reference text not null,
  analysis_type text not null,
  measured_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'validated', 'released', 'void')),
  value numeric,
  unit text,
  uncertainty numeric check (uncertainty is null or uncertainty >= 0),
  method text,
  instrument text,
  source_document_id uuid references public.client_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_number text not null unique,
  issue_date date not null default current_date,
  due_date date,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(12, 2) not null default 0 check (total_amount >= 0),
  currency text not null default 'EUR'
    check (char_length(currency) = 3),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or due_date >= issue_date)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.client_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.equipment_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  name text not null,
  manufacturer text,
  model text,
  serial_number text,
  location text,
  status text not null default 'active'
    check (status in ('active', 'service_due', 'out_of_service', 'retired')),
  provider_id uuid references public.providers(id) on delete set null,
  last_service_at timestamptz,
  next_service_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lab_book_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null default 'general'
    check (entry_type in ('general', 'maintenance', 'calibration', 'incident', 'quality_control')),
  title text not null,
  occurred_at timestamptz not null default now(),
  asset_id uuid references public.equipment_assets(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  status text not null default 'completed'
    check (status in ('scheduled', 'in_progress', 'completed', 'failed', 'cancelled')),
  performed_by text,
  description text,
  next_due_at timestamptz,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.backup_records (
  id uuid primary key default gen_random_uuid(),
  system_name text not null,
  backup_type text not null default 'database'
    check (backup_type in ('database', 'documents', 'instrument', 'configuration', 'full')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'verified')),
  destination text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (completed_at is null or completed_at >= started_at)
);

alter table public.material_purchase_lists
  add column if not exists provider_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_purchase_lists_provider_id_fkey'
      and conrelid = 'public.material_purchase_lists'::regclass
  ) then
    alter table public.material_purchase_lists
      add constraint material_purchase_lists_provider_id_fkey
      foreign key (provider_id) references public.providers(id) on delete set null;
  end if;
end
$$;

create index if not exists providers_status_name_idx
  on public.providers (status, name);
create index if not exists provider_materials_provider_id_idx
  on public.provider_materials (provider_id);
create index if not exists provider_materials_material_id_idx
  on public.provider_materials (material_id);
create index if not exists client_results_client_status_measured_idx
  on public.client_results (client_id, status, measured_at desc);
create index if not exists client_results_source_document_id_idx
  on public.client_results (source_document_id);
create index if not exists client_invoices_client_status_due_idx
  on public.client_invoices (client_id, status, due_date);
create index if not exists client_invoices_open_due_idx
  on public.client_invoices (due_date)
  where status in ('sent', 'overdue');
create index if not exists invoice_items_invoice_id_idx
  on public.invoice_items (invoice_id);
create index if not exists equipment_assets_provider_id_idx
  on public.equipment_assets (provider_id);
create index if not exists equipment_assets_status_next_service_idx
  on public.equipment_assets (status, next_service_at);
create index if not exists lab_book_entries_asset_id_idx
  on public.lab_book_entries (asset_id);
create index if not exists lab_book_entries_provider_id_idx
  on public.lab_book_entries (provider_id);
create index if not exists lab_book_entries_type_occurred_idx
  on public.lab_book_entries (entry_type, occurred_at desc);
create index if not exists lab_book_entries_next_due_idx
  on public.lab_book_entries (next_due_at)
  where next_due_at is not null and status <> 'cancelled';
create index if not exists backup_records_status_started_idx
  on public.backup_records (status, started_at desc);
create index if not exists material_purchase_lists_provider_id_idx
  on public.material_purchase_lists (provider_id);

drop trigger if exists providers_set_updated_at on public.providers;
create trigger providers_set_updated_at
before update on public.providers
for each row execute function public.set_updated_at();

drop trigger if exists provider_materials_set_updated_at on public.provider_materials;
create trigger provider_materials_set_updated_at
before update on public.provider_materials
for each row execute function public.set_updated_at();

drop trigger if exists client_results_set_updated_at on public.client_results;
create trigger client_results_set_updated_at
before update on public.client_results
for each row execute function public.set_updated_at();

drop trigger if exists client_invoices_set_updated_at on public.client_invoices;
create trigger client_invoices_set_updated_at
before update on public.client_invoices
for each row execute function public.set_updated_at();

drop trigger if exists equipment_assets_set_updated_at on public.equipment_assets;
create trigger equipment_assets_set_updated_at
before update on public.equipment_assets
for each row execute function public.set_updated_at();

drop trigger if exists lab_book_entries_set_updated_at on public.lab_book_entries;
create trigger lab_book_entries_set_updated_at
before update on public.lab_book_entries
for each row execute function public.set_updated_at();

drop trigger if exists backup_records_set_updated_at on public.backup_records;
create trigger backup_records_set_updated_at
before update on public.backup_records
for each row execute function public.set_updated_at();

alter table public.providers enable row level security;
alter table public.provider_materials enable row level security;
alter table public.client_results enable row level security;
alter table public.client_invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.equipment_assets enable row level security;
alter table public.lab_book_entries enable row level security;
alter table public.backup_records enable row level security;

-- Remove the permissive anonymous policies from the original prototype.
drop policy if exists "clients_select_all" on public.clients;
drop policy if exists "clients_modify_all" on public.clients;
drop policy if exists "client_documents_select_all" on public.client_documents;
drop policy if exists "client_documents_modify_all" on public.client_documents;
drop policy if exists "client_credit_events_select_all" on public.client_credit_events;
drop policy if exists "client_credit_events_modify_all" on public.client_credit_events;
drop policy if exists "materials_inventory_select_all" on public.materials_inventory;
drop policy if exists "materials_inventory_modify_all" on public.materials_inventory;
drop policy if exists "material_stock_movements_select_all" on public.material_stock_movements;
drop policy if exists "material_stock_movements_modify_all" on public.material_stock_movements;
drop policy if exists "material_purchase_lists_select_all" on public.material_purchase_lists;
drop policy if exists "material_purchase_lists_modify_all" on public.material_purchase_lists;
drop policy if exists "material_purchase_list_items_select_all" on public.material_purchase_list_items;
drop policy if exists "material_purchase_list_items_modify_all" on public.material_purchase_list_items;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
