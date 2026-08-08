-- Server-only OAuth credentials for the P2L assistant Gmail integration.

create table if not exists public.gmail_connections (
  id text primary key default 'default' check (id = 'default'),
  email text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  scope text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists gmail_connections_set_updated_at
  on public.gmail_connections;
create trigger gmail_connections_set_updated_at
before update on public.gmail_connections
for each row execute function public.set_updated_at();

alter table public.gmail_connections enable row level security;
revoke all on public.gmail_connections from anon, authenticated;
grant all on public.gmail_connections to service_role;
