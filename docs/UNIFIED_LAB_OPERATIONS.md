# Unified laboratory operations architecture

## Current-state assessment

The original application had three useful but disconnected parts:

- a FastAPI scientific-processing backend for IRMS ingest, calibration, diagnostics, and reports;
- a client manager that indexed the `Clienti/` folder and maintained a credit ledger;
- a materials manager that indexed the `Mantainance/` folder, tracked stock, and created purchase lists.

The review found these structural gaps:

- the client and materials screens each carried their own navigation and page shell;
- client results and invoices were represented only as source documents, not structured operational records;
- providers existed only as free-text purchase-list fields;
- maintenance, equipment, calibration, incidents, and backups had no unified laboratory book;
- the frontend catch-all `/api/*` rewrite sent application-owned Next.js routes to FastAPI;
- the original Supabase migrations granted anonymous users unrestricted read and write access;
- environment examples contained remote-project values instead of a reproducible local workflow.

## Unified application map

| Route        | Operational purpose                                          | Main records                                             |
| ------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| `/`          | Cross-module work queue and recent activity                  | all operational tables                                   |
| `/clients`   | Client files and credit ledger                               | `clients`, `client_documents`, `client_credit_events`    |
| `/results`   | Result capture, validation, and release                      | `client_results`                                         |
| `/finance`   | Invoice issue, collection, and payment state                 | `client_invoices`, `invoice_items`                       |
| `/materials` | Inventory, stock movement, and purchase lists                | materials tables                                         |
| `/providers` | Approved supply contacts and lead times                      | `providers`, `provider_materials`                        |
| `/lab-book`  | Equipment, maintenance, calibration, incidents, and backups  | `equipment_assets`, `lab_book_entries`, `backup_records` |
| `/assistant` | Operational search, reporting, and authorized record actions | server-side platform tools                               |

The FastAPI service remains responsible for scientific computation. It is now proxied under `/backend-api/*`, leaving `/api/*` for the Next.js application routes.

## Database model

The migration `20260806192020_unified_lab_operations.sql` extends the two original schemas with:

- `providers` and `provider_materials`;
- `client_results`;
- `client_invoices` and `invoice_items`;
- `equipment_assets`;
- `lab_book_entries`;
- `backup_records`;
- an optional provider relationship on purchase lists.

Foreign keys are indexed. Operational filters use composite or partial indexes for result state, open invoice due dates, service schedules, laboratory-book chronology, and backup state.

All public tables keep RLS enabled. Browser roles receive no grants or permissive policies. Next.js server routes use the local service role; the service key never enters browser code.

This is a local trusted-workstation access model. Before exposing the application to a network, add user authentication and organization-scoped RLS policies to the server routes.

## Docker-free local database workflow

Prerequisites:

- Node.js 22 or newer.

Run:

```powershell
npm install
npm run dev:local
```

`dev:local` initializes the embedded PGlite/PostgreSQL data directory at
`.local-data/app-postgres`, selects the first free port from 3000 through 3010,
and starts the frontend. Docker and a separate database service are not
required.

Database health and backups are available through `GET /api/database` and
`POST /api/database`. See `docs/LOCAL_DATABASE.md` for storage and future
Supabase migration details.

The `supabase/migrations` directory remains the canonical migration target for
a future hosted Supabase deployment. If you deliberately use a local Supabase
development stack, its reset command is:

```powershell
npm run supabase:reset
```

After reset:

1. open the client screen and sync `Clienti/`;
2. open inventory and sync `Mantainance/`;
3. replace the placeholder provider contacts in the seeded local records;
4. record the first real database and document backup, then remove or supersede the starter backup evidence.

The local application is for private workstation use. It must not be exposed
directly to an untrusted network without authentication and access controls.

## UI pattern mapping

| Target need                  | Implemented pattern                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| Unified navigation           | fixed two-level application shell                                  |
| Laboratory state at a glance | laboratory pulse rail for results, maintenance, and backup recency |
| Comparable metrics           | divided `MetricRail`, not independent floating cards               |
| Dense operational content    | compact section panels and ledger-style tables                     |
| Search and filters           | pale bordered toolbars with 32–36px controls                       |
| State communication          | semantic outlined status pills                                     |
| Mobile navigation            | one compact section selector below the wide breakpoint             |
| Light/dark operation         | slate-tinted token system with saved theme preference              |

Typography roles are Manrope for interface copy, Space Grotesk for hierarchy, and Geist Mono for codes, timestamps, currency, quantities, and telemetry.

## Known boundaries

- Starting and resetting Supabase could not be executed in the current environment because no Docker-compatible runtime was installed.
- Backup records document backup work; they do not execute operating-system backup jobs.
- Invoice item schema exists, while the first UI pass creates invoice totals at header level.
- The existing spreadsheet parser uses `xlsx`, for which npm reports unresolved security advisories. Treat imported files as trusted until the parser is replaced or sandboxed.
- The application remains on Next.js 14 for compatibility. Current npm advisories require a planned major-version upgrade rather than an unsafe forced update.
- Screenshot-based responsive QA remains to be completed because no controllable browser was attached to this session.
