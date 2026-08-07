create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  folder_slug text not null unique,
  first_seen_year integer,
  last_seen_year integer,
  total_documents integer not null default 0,
  categories text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_name text not null,
  relative_path text not null unique,
  absolute_path text not null,
  year integer,
  extension text not null,
  category text not null default 'other',
  inferred_document_number text,
  inferred_document_date date,
  file_size_bytes bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.client_credit_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_type text not null default 'manual',
  source_document_id uuid references public.client_documents(id) on delete set null,
  source_relative_path text,
  source_sheet text not null default '',
  source_row integer,
  event_type text not null default 'adjustment',
  event_date date,
  analyses_count numeric,
  unit_cost numeric,
  amount numeric,
  balance_before numeric,
  balance_after numeric,
  comment text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint client_credit_events_source_type_check check (
    source_type in ('spreadsheet', 'manual')
  ),
  constraint client_credit_events_event_type_check check (
    event_type in ('analysis', 'credit_topup', 'adjustment')
  )
);

create index if not exists idx_clients_name on public.clients(name);
create index if not exists idx_clients_folder_slug on public.clients(folder_slug);
create index if not exists idx_client_documents_client_id on public.client_documents(client_id);
create index if not exists idx_client_documents_year on public.client_documents(year);
create index if not exists idx_client_documents_category on public.client_documents(category);
create index if not exists idx_client_credit_events_client_id on public.client_credit_events(client_id);
create index if not exists idx_client_credit_events_event_date on public.client_credit_events(event_date);
create index if not exists idx_client_credit_events_source_type on public.client_credit_events(source_type);
create unique index if not exists idx_client_credit_events_source_unique
on public.client_credit_events(
  client_id,
  source_type,
  source_relative_path,
  source_sheet,
  source_row
);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists client_documents_set_updated_at on public.client_documents;
create trigger client_documents_set_updated_at
before update on public.client_documents
for each row execute function public.set_updated_at();

drop trigger if exists client_credit_events_set_updated_at on public.client_credit_events;
create trigger client_credit_events_set_updated_at
before update on public.client_credit_events
for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
alter table public.client_documents enable row level security;
alter table public.client_credit_events enable row level security;

drop policy if exists "clients_select_all" on public.clients;
create policy "clients_select_all"
on public.clients
for select
to anon, authenticated
using (true);

drop policy if exists "clients_modify_all" on public.clients;
create policy "clients_modify_all"
on public.clients
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "client_documents_select_all" on public.client_documents;
create policy "client_documents_select_all"
on public.client_documents
for select
to anon, authenticated
using (true);

drop policy if exists "client_documents_modify_all" on public.client_documents;
create policy "client_documents_modify_all"
on public.client_documents
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "client_credit_events_select_all" on public.client_credit_events;
create policy "client_credit_events_select_all"
on public.client_credit_events
for select
to anon, authenticated
using (true);

drop policy if exists "client_credit_events_modify_all" on public.client_credit_events;
create policy "client_credit_events_modify_all"
on public.client_credit_events
for all
to anon, authenticated
using (true)
with check (true);
