alter table public.client_credit_events
  add column if not exists equipment text;
