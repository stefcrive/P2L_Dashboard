update public.client_credit_events
set event_type = 'adjustment'
where event_type = 'payment';

alter table public.client_credit_events
  drop constraint if exists client_credit_events_event_type_check;

alter table public.client_credit_events
  add constraint client_credit_events_event_type_check
  check (event_type in ('analysis', 'credit_topup', 'adjustment'));
