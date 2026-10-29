-- Use the same three-state workflow in the sample queue and its calendar items.

update public.sample_queue_items
set status = case
  when status in ('preparing', 'running', 'quality_review') then 'analysing'
  when status = 'completed' then 'completed'
  else 'queued'
end
where status not in ('queued', 'analysing', 'completed');

alter table public.sample_queue_items
  drop constraint if exists sample_queue_items_status_check;
alter table public.sample_queue_items
  add constraint sample_queue_items_status_check
  check (status in ('queued', 'analysing', 'completed'));

alter table public.lab_book_entries
  drop constraint if exists lab_book_entries_status_check;
alter table public.lab_book_entries
  add constraint lab_book_entries_status_check
  check (status in (
    'queued', 'analysing', 'completed',
    'scheduled', 'in_progress', 'failed', 'cancelled'
  ));

update public.lab_book_entries
set status = case status
  when 'scheduled' then 'queued'
  when 'in_progress' then 'analysing'
  else status
end
where source_key like 'sample-queue:%'
  and status in ('scheduled', 'in_progress');
