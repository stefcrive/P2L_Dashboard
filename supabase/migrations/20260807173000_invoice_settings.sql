-- Persistent defaults for branded invoice generation.

create table if not exists public.invoice_settings (
  id text primary key default 'default' check (id = 'default'),
  issuer_details text not null default '',
  national_payment_details text not null default '',
  international_payment_details text not null default '',
  default_payment_instructions text not null default 'both'
    check (default_payment_instructions in ('national', 'international', 'both')),
  default_currency text not null default 'BRL'
    check (char_length(default_currency) = 3),
  default_language text not null default 'en'
    check (default_language in ('en', 'pt')),
  footer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.invoice_settings (
  id,
  issuer_details,
  footer_note
)
values (
  'default',
  E'Laboratório de Paleoceanografia e Paleoclimatologia (P2L)\nEscola de Artes, Ciências e Humanidades\nUniversidade de São Paulo\nSão Paulo, Brazil',
  'P2L · EACH-USP · Universidade de São Paulo'
)
on conflict (id) do nothing;

drop trigger if exists invoice_settings_set_updated_at
  on public.invoice_settings;
create trigger invoice_settings_set_updated_at
before update on public.invoice_settings
for each row execute function public.set_updated_at();

alter table public.invoice_settings enable row level security;
revoke all on public.invoice_settings from anon, authenticated;
grant all on public.invoice_settings to service_role;
