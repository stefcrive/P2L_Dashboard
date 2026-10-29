alter table public.equipment_assets
  add column if not exists maintenance_interval_months integer;

alter table public.equipment_assets
  drop constraint if exists equipment_assets_maintenance_interval_check;
alter table public.equipment_assets
  add constraint equipment_assets_maintenance_interval_check
  check (maintenance_interval_months is null or maintenance_interval_months > 0);

create table if not exists public.equipment_components (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.equipment_assets(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  maintenance_interval_months integer
    check (maintenance_interval_months is null or maintenance_interval_months > 0),
  last_maintenance_at timestamptz,
  next_maintenance_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_id, name)
);

create index if not exists equipment_components_asset_order_idx
  on public.equipment_components (asset_id, sort_order, name);
create index if not exists equipment_components_next_maintenance_idx
  on public.equipment_components (next_maintenance_at)
  where next_maintenance_at is not null;

create or replace function public.sync_equipment_maintenance_alert()
returns trigger
language plpgsql
as $$
declare
  alert_key text;
  alert_title text;
  alert_subject text;
  alert_description text;
  alert_asset_id uuid;
  alert_provider_id uuid;
  alert_due_at timestamptz;
  alert_interval integer;
  asset_name text;
begin
  if tg_table_name = 'equipment_assets' then
    alert_key := 'maintenance:asset:' || new.id::text || ':pending';
    alert_title := 'Scheduled maintenance · ' || new.name;
    alert_subject := new.name;
    alert_description := 'Recurring equipment maintenance alert. Completing this record schedules the next occurrence automatically.';
    alert_asset_id := new.id;
    alert_provider_id := new.provider_id;
    alert_due_at := new.next_service_at;
    alert_interval := new.maintenance_interval_months;
  else
    select asset.name, asset.provider_id
      into asset_name, alert_provider_id
    from public.equipment_assets as asset
    where asset.id = new.asset_id;

    alert_key := 'maintenance:component:' || new.id::text || ':pending';
    alert_title := 'Scheduled maintenance · ' || asset_name || ' · ' || new.name;
    alert_subject := new.name;
    alert_description := coalesce(
      nullif(new.notes, ''),
      'Recurring component maintenance alert. Completing this record schedules the next occurrence automatically.'
    );
    alert_asset_id := new.asset_id;
    alert_due_at := new.next_maintenance_at;
    alert_interval := new.maintenance_interval_months;
  end if;

  if alert_due_at is null or alert_interval is null then
    update public.lab_book_entries
    set status = 'cancelled'
    where source_key = alert_key
      and status <> 'completed';
    return new;
  end if;

  insert into public.lab_book_entries (
    source_key,
    entry_type,
    title,
    occurred_at,
    date_precision,
    asset_id,
    provider_id,
    status,
    description,
    subject,
    next_due_at
  )
  values (
    alert_key,
    'maintenance',
    alert_title,
    alert_due_at,
    'estimated',
    alert_asset_id,
    alert_provider_id,
    'scheduled',
    alert_description,
    alert_subject,
    alert_due_at
  )
  on conflict (source_key) where source_key is not null
  do update set
    title = excluded.title,
    occurred_at = excluded.occurred_at,
    date_precision = excluded.date_precision,
    asset_id = excluded.asset_id,
    provider_id = excluded.provider_id,
    status = case
      when public.lab_book_entries.status = 'cancelled' then 'scheduled'
      else public.lab_book_entries.status
    end,
    description = excluded.description,
    subject = excluded.subject,
    next_due_at = excluded.next_due_at;

  return new;
end;
$$;

create or replace function public.roll_forward_equipment_maintenance_alert()
returns trigger
language plpgsql
as $$
declare
  source_id uuid;
begin
  if new.source_key like 'maintenance:asset:%:pending' then
    source_id := split_part(new.source_key, ':', 3)::uuid;

    if new.status = 'completed' and old.status is distinct from 'completed' then
      update public.lab_book_entries
      set source_key = 'maintenance:asset:' || source_id::text || ':completed:' || new.id::text
      where id = new.id;

      update public.equipment_assets
      set last_service_at = new.occurred_at,
          next_service_at = new.occurred_at
            + make_interval(months => maintenance_interval_months)
      where id = source_id
        and maintenance_interval_months is not null;
    elsif new.status = 'scheduled'
      and new.occurred_at is distinct from old.occurred_at then
      update public.equipment_assets
      set next_service_at = new.occurred_at
      where id = source_id;
    end if;
  elsif new.source_key like 'maintenance:component:%:pending' then
    source_id := split_part(new.source_key, ':', 3)::uuid;

    if new.status = 'completed' and old.status is distinct from 'completed' then
      update public.lab_book_entries
      set source_key = 'maintenance:component:' || source_id::text || ':completed:' || new.id::text
      where id = new.id;

      update public.equipment_components
      set last_maintenance_at = new.occurred_at,
          next_maintenance_at = new.occurred_at
            + make_interval(months => maintenance_interval_months)
      where id = source_id
        and maintenance_interval_months is not null;
    elsif new.status = 'scheduled'
      and new.occurred_at is distinct from old.occurred_at then
      update public.equipment_components
      set next_maintenance_at = new.occurred_at
      where id = source_id;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.cancel_deleted_equipment_maintenance_alert()
returns trigger
language plpgsql
as $$
begin
  update public.lab_book_entries
  set status = 'cancelled'
  where source_key = case
    when tg_table_name = 'equipment_assets'
      then 'maintenance:asset:' || old.id::text || ':pending'
    else 'maintenance:component:' || old.id::text || ':pending'
  end
    and status <> 'completed';
  return old;
end;
$$;

drop trigger if exists equipment_assets_sync_maintenance_alert on public.equipment_assets;
create trigger equipment_assets_sync_maintenance_alert
after insert or update of name, provider_id, next_service_at, maintenance_interval_months
on public.equipment_assets
for each row execute function public.sync_equipment_maintenance_alert();

drop trigger if exists equipment_assets_cancel_maintenance_alert on public.equipment_assets;
create trigger equipment_assets_cancel_maintenance_alert
after delete on public.equipment_assets
for each row execute function public.cancel_deleted_equipment_maintenance_alert();

drop trigger if exists equipment_components_set_updated_at on public.equipment_components;
create trigger equipment_components_set_updated_at
before update on public.equipment_components
for each row execute function public.set_updated_at();

drop trigger if exists equipment_components_sync_maintenance_alert on public.equipment_components;
create trigger equipment_components_sync_maintenance_alert
after insert or update of asset_id, name, next_maintenance_at, maintenance_interval_months, notes
on public.equipment_components
for each row execute function public.sync_equipment_maintenance_alert();

drop trigger if exists equipment_components_cancel_maintenance_alert on public.equipment_components;
create trigger equipment_components_cancel_maintenance_alert
after delete on public.equipment_components
for each row execute function public.cancel_deleted_equipment_maintenance_alert();

drop trigger if exists lab_book_roll_forward_maintenance_alert on public.lab_book_entries;
create trigger lab_book_roll_forward_maintenance_alert
after update of status, occurred_at on public.lab_book_entries
for each row execute function public.roll_forward_equipment_maintenance_alert();

alter table public.equipment_components enable row level security;
revoke all on table public.equipment_components from anon, authenticated;
revoke execute on function public.sync_equipment_maintenance_alert() from public, anon, authenticated;
revoke execute on function public.roll_forward_equipment_maintenance_alert() from public, anon, authenticated;
revoke execute on function public.cancel_deleted_equipment_maintenance_alert() from public, anon, authenticated;

insert into public.equipment_assets (asset_code, name, location, status)
values
  ('IRMS-01', 'MAT 253 isotope ratio mass spectrometer', 'Instrument room', 'active'),
  ('KIEL-01', 'Kiel carbonate preparation device', 'Instrument room', 'active'),
  ('AIR-COMP-01', 'Air compressor', 'Laboratory', 'active'),
  ('MILLIQ-01', 'Milli-Q station', 'Laboratory', 'active'),
  ('FUME-HEPA-01', 'Fume hood HEPA', 'Laboratory', 'active'),
  ('WASH-01', 'Washing machine', 'Laboratory', 'active'),
  ('DRY-OVEN-01', 'Drying oven', 'Laboratory', 'active'),
  ('HVAC-01', 'Air conditioning', 'Laboratory', 'active')
on conflict (asset_code) do nothing;

insert into public.equipment_components (asset_id, name, sort_order)
select asset.id, component.name, component.sort_order
from public.equipment_assets as asset
join (
  values
    ('IRMS-01', 'Turbo pump', 0),
    ('KIEL-01', 'Turbo pump', 0),
    ('KIEL-01', 'Acid line', 1),
    ('KIEL-01', 'Viton O-rings', 2),
    ('KIEL-01', 'Acid reservoir humidity filter', 3)
) as component(asset_code, name, sort_order)
  on component.asset_code = asset.asset_code
on conflict (asset_id, name) do nothing;

-- Create pending lab-book/calendar alerts for schedules that predate this migration.
update public.equipment_assets
set maintenance_interval_months = maintenance_interval_months
where maintenance_interval_months is not null
  and next_service_at is not null;
