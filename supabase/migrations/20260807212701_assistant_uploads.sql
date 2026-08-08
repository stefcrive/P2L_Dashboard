create table if not exists public.assistant_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size_bytes bigint not null check (file_size_bytes > 0),
  content_sha256 text not null,
  content bytea not null,
  attached_document_id uuid references public.client_documents(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists assistant_uploads_created_idx
  on public.assistant_uploads (created_at desc);
create index if not exists assistant_uploads_document_idx
  on public.assistant_uploads (attached_document_id)
  where attached_document_id is not null;

alter table public.assistant_uploads enable row level security;
revoke all on table public.assistant_uploads from anon, authenticated;
grant all on table public.assistant_uploads to service_role;
