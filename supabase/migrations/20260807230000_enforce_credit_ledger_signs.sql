-- Keep credits and charges unambiguous throughout the ledger.
update public.client_credit_events
set amount = case
  when event_type = 'analysis' then -abs(amount)
  when event_type = 'credit_topup' then abs(amount)
  else amount
end
where amount is not null
  and event_type in ('analysis', 'credit_topup');

alter table public.client_credit_events
  drop constraint if exists client_credit_events_amount_sign_check;

alter table public.client_credit_events
  add constraint client_credit_events_amount_sign_check
  check (
    amount is null
    or event_type = 'adjustment'
    or (event_type = 'analysis' and amount <= 0)
    or (event_type = 'credit_topup' and amount >= 0)
  );
