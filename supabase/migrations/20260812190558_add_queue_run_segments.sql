-- Allow one queue batch to pause and resume as multiple scheduled instrument runs.

create table if not exists public.sample_queue_segments (
  id uuid primary key default gen_random_uuid(),
  queue_item_id uuid not null
    references public.sample_queue_items(id) on delete cascade,
  segment_order integer not null default 1 check (segment_order > 0),
  run_position integer not null default 0 check (run_position >= 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (queue_item_id, segment_order),
  check (end_at >= start_at)
);

insert into public.sample_queue_segments
  (queue_item_id, segment_order, run_position, start_at, end_at)
select id, 1, queue_position, estimated_start_at, estimated_end_at
from public.sample_queue_items
on conflict (queue_item_id, segment_order) do nothing;

create index if not exists sample_queue_segments_item_idx
  on public.sample_queue_segments (queue_item_id, segment_order);
create index if not exists sample_queue_segments_window_idx
  on public.sample_queue_segments (start_at, end_at);
create index if not exists sample_queue_segments_run_position_idx
  on public.sample_queue_segments (run_position);

drop trigger if exists sample_queue_segments_set_updated_at
  on public.sample_queue_segments;
create trigger sample_queue_segments_set_updated_at
before update on public.sample_queue_segments
for each row execute function public.set_updated_at();

alter table public.sample_queue_segments enable row level security;
revoke all on public.sample_queue_segments from anon, authenticated;
grant all on public.sample_queue_segments to service_role;
