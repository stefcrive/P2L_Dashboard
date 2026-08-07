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

create table if not exists public.materials_inventory (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  name text not null,
  part_number text,
  description text,
  material_type text not null default 'other',
  equipment text,
  quantity_text text,
  suggested_stock numeric,
  current_stock numeric,
  minimum_stock numeric,
  unit text,
  supplier_reference text,
  source_file text not null,
  source_sheet text,
  source_path text not null,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.material_stock_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials_inventory(id) on delete cascade,
  movement_type text not null,
  amount numeric not null,
  previous_stock numeric,
  new_stock numeric,
  note text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.material_purchase_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_name text,
  provider_contact text,
  notes text,
  status text not null default 'draft',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.material_purchase_list_items (
  id uuid primary key default gen_random_uuid(),
  purchase_list_id uuid not null references public.material_purchase_lists(id) on delete cascade,
  material_id uuid references public.materials_inventory(id) on delete set null,
  quantity numeric not null default 1,
  note text,
  material_name_snapshot text not null,
  part_number_snapshot text,
  material_type_snapshot text,
  unit_snapshot text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_materials_inventory_name on public.materials_inventory(name);
create index if not exists idx_materials_inventory_type on public.materials_inventory(material_type);
create index if not exists idx_materials_inventory_equipment on public.materials_inventory(equipment);
create index if not exists idx_materials_inventory_part_number on public.materials_inventory(part_number);
create index if not exists idx_material_stock_movements_material_id on public.material_stock_movements(material_id);
create index if not exists idx_material_purchase_lists_created_at on public.material_purchase_lists(created_at desc);
create index if not exists idx_material_purchase_list_items_list_id on public.material_purchase_list_items(purchase_list_id);

drop trigger if exists materials_inventory_set_updated_at on public.materials_inventory;
create trigger materials_inventory_set_updated_at
before update on public.materials_inventory
for each row execute function public.set_updated_at();

drop trigger if exists material_purchase_lists_set_updated_at on public.material_purchase_lists;
create trigger material_purchase_lists_set_updated_at
before update on public.material_purchase_lists
for each row execute function public.set_updated_at();

alter table public.materials_inventory enable row level security;
alter table public.material_stock_movements enable row level security;
alter table public.material_purchase_lists enable row level security;
alter table public.material_purchase_list_items enable row level security;

drop policy if exists "materials_inventory_select_all" on public.materials_inventory;
create policy "materials_inventory_select_all"
on public.materials_inventory
for select
to anon, authenticated
using (true);

drop policy if exists "materials_inventory_modify_all" on public.materials_inventory;
create policy "materials_inventory_modify_all"
on public.materials_inventory
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "material_stock_movements_select_all" on public.material_stock_movements;
create policy "material_stock_movements_select_all"
on public.material_stock_movements
for select
to anon, authenticated
using (true);

drop policy if exists "material_stock_movements_modify_all" on public.material_stock_movements;
create policy "material_stock_movements_modify_all"
on public.material_stock_movements
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "material_purchase_lists_select_all" on public.material_purchase_lists;
create policy "material_purchase_lists_select_all"
on public.material_purchase_lists
for select
to anon, authenticated
using (true);

drop policy if exists "material_purchase_lists_modify_all" on public.material_purchase_lists;
create policy "material_purchase_lists_modify_all"
on public.material_purchase_lists
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "material_purchase_list_items_select_all" on public.material_purchase_list_items;
create policy "material_purchase_list_items_select_all"
on public.material_purchase_list_items
for select
to anon, authenticated
using (true);

drop policy if exists "material_purchase_list_items_modify_all" on public.material_purchase_list_items;
create policy "material_purchase_list_items_modify_all"
on public.material_purchase_list_items
for all
to anon, authenticated
using (true)
with check (true);
