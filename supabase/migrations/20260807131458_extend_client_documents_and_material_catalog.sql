alter table public.client_documents
  add column if not exists mime_type text,
  add column if not exists content_sha256 text,
  add column if not exists content bytea,
  add column if not exists storage_origin text not null default 'folder'
    check (storage_origin in ('folder', 'upload'));

alter table public.materials_inventory
  add column if not exists availability_status text not null default 'available'
    check (availability_status in (
      'available', 'low_stock', 'out_of_stock', 'on_order', 'unavailable'
    )),
  add column if not exists unit_cost numeric(14, 2)
    check (unit_cost is null or unit_cost >= 0),
  add column if not exists currency text not null default 'BRL'
    check (char_length(currency) = 3),
  add column if not exists storage_location text,
  add column if not exists catalog_locked boolean not null default false,
  add column if not exists provider_id uuid
    references public.providers(id) on delete set null;

create index if not exists client_documents_client_created_idx
  on public.client_documents (client_id, created_at desc);

create index if not exists materials_inventory_provider_idx
  on public.materials_inventory (provider_id);
