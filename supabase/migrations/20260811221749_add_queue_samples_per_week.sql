-- Store an explicit throughput assumption for queue duration calculations.

alter table public.sample_queue_items
  add column if not exists samples_per_week numeric(10, 2);

update public.sample_queue_items
set samples_per_week = greatest(
  1,
  round(
    sample_count::numeric * 7 /
    greatest(1, estimated_end_at::date - estimated_start_at::date + 1),
    2
  )
)
where samples_per_week is null;

alter table public.sample_queue_items
  alter column samples_per_week set default 100,
  alter column samples_per_week set not null;

alter table public.sample_queue_items
  drop constraint if exists sample_queue_items_samples_per_week_check;
alter table public.sample_queue_items
  add constraint sample_queue_items_samples_per_week_check
  check (samples_per_week > 0);
