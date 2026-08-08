alter table public.lab_book_entries
  add column if not exists source_key text,
  add column if not exists date_precision text not null default 'day',
  add column if not exists reported_at timestamptz,
  add column if not exists source_reference text,
  add column if not exists subject text,
  add column if not exists institution text,
  add column if not exists project_reference text,
  add column if not exists material text,
  add column if not exists quantity integer;

alter table public.lab_book_entries
  drop constraint if exists lab_book_entries_entry_type_check;
alter table public.lab_book_entries
  add constraint lab_book_entries_entry_type_check
  check (entry_type in (
    'publication', 'masters_delivery', 'phd_delivery', 'results_delivery',
    'maintenance', 'calibration', 'incident', 'quality_control', 'software',
    'infrastructure', 'general'
  ));

alter table public.lab_book_entries
  drop constraint if exists lab_book_entries_date_precision_check;
alter table public.lab_book_entries
  add constraint lab_book_entries_date_precision_check
  check (date_precision in ('day', 'month', 'year', 'cutoff', 'estimated'));

alter table public.lab_book_entries
  drop constraint if exists lab_book_entries_quantity_check;
alter table public.lab_book_entries
  add constraint lab_book_entries_quantity_check
  check (quantity is null or quantity >= 0);

create unique index if not exists lab_book_source_key_unique_idx
  on public.lab_book_entries (source_key) where source_key is not null;
create index if not exists lab_book_subject_idx
  on public.lab_book_entries (subject, occurred_at desc);

