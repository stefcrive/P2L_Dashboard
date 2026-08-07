# Docker-free local application database

P2L Dashboard stores operational application data in an embedded PostgreSQL
database powered by PGlite. It does not require Docker, a database service, or
network access.

## Storage

- Operational data: `.local-data/app-postgres`
- Knowledge/RAG data: `.local-data/knowledge-postgres`
- Database snapshots: `.local-data/backups`

These directories are ignored by Git. Do not delete them when updating source
code.

Run the application with:

```powershell
npm run dev:local
```

The normal `npm run dev` command also defaults to embedded local storage.

## Backups and health

`GET /api/database` returns the database location, schema version, size, and
per-table row counts. `POST /api/database` writes a compressed, restart-safe
snapshot under `.local-data/backups` and records it in `backup_records`.

Back up both the snapshot files and the original raw laboratory documents. The
database does not replace source-document backups.

## Future Supabase migration

The local schema mirrors the PostgreSQL tables in `supabase/migrations`. To
switch the application after importing data into Supabase, set:

```dotenv
APP_DATABASE_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_LOCAL_ONLY=false
```

Apply the repository migrations to the Supabase project before importing rows.
The primary keys are UUIDs and relationships are standard PostgreSQL foreign
keys, so records can be exported and inserted without changing application
identifiers.
