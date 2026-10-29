-- Preserve calendar dates that a user moves or resizes manually.

alter table public.sample_queue_segments
  add column if not exists user_edited boolean not null default false;
