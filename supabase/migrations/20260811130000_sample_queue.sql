-- Sample check-in, scheduling, and lab-book synchronization model.

alter table public.lab_book_entries
  drop constraint if exists lab_book_entries_entry_type_check;
alter table public.lab_book_entries
  add constraint lab_book_entries_entry_type_check
  check (entry_type in (
    'publication', 'masters_delivery', 'phd_delivery', 'results_delivery',
    'maintenance', 'calibration', 'incident', 'quality_control', 'software',
    'infrastructure', 'sample_analysis', 'general'
  ));

create table if not exists public.sample_queue_items (
  id uuid primary key default gen_random_uuid(),
  queue_code text not null unique,
  queue_position integer not null default 0 check (queue_position >= 0),
  client_id uuid references public.clients(id) on delete set null,
  sample_label text not null,
  sample_count integer not null default 1 check (sample_count > 0),
  analysis_type text not null,
  matrix text,
  priority text not null default 'routine'
    check (priority in ('routine', 'priority', 'urgent')),
  status text not null default 'queued'
    check (status in ('queued', 'analysing', 'completed')),
  checked_in_at timestamptz not null default now(),
  estimated_start_at timestamptz not null,
  estimated_end_at timestamptz not null,
  actual_started_at timestamptz,
  completed_at timestamptz,
  asset_id uuid references public.equipment_assets(id) on delete set null,
  operator text,
  attachments jsonb not null default '[]'::jsonb,
  notes text,
  lab_book_entry_id uuid unique
    references public.lab_book_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (estimated_end_at >= estimated_start_at),
  check (completed_at is null or actual_started_at is null or completed_at >= actual_started_at)
);

create index if not exists sample_queue_position_idx
  on public.sample_queue_items (status, queue_position);
create index if not exists sample_queue_window_idx
  on public.sample_queue_items (estimated_start_at, estimated_end_at);
create index if not exists sample_queue_client_idx
  on public.sample_queue_items (client_id, checked_in_at desc);

drop trigger if exists sample_queue_items_set_updated_at on public.sample_queue_items;
create trigger sample_queue_items_set_updated_at
before update on public.sample_queue_items
for each row execute function public.set_updated_at();

alter table public.sample_queue_items enable row level security;
revoke all on public.sample_queue_items from anon, authenticated;
grant all on public.sample_queue_items to service_role;
