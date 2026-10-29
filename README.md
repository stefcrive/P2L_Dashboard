# P2L Laboratory Operations

A laboratory workstation for IRMS processing, client data, results, credits, invoices, inventory, providers, maintenance, laboratory-book records, and backup evidence.

The operational version is [P2L Dashboard](https://p2l-dashboard.vercel.app).
`start_app.bat` opens it. Vercel deploys the GitHub `main` branch automatically.
Use `start_local.bat` for offline development or `start_cloud_dev.bat` to run locally
with the live cloud records. See [hosted operations](docs/HOSTED_OPERATIONS.md).

See [the unified architecture](docs/UNIFIED_LAB_OPERATIONS.md) for the current-state assessment, route-to-domain mapping, database model, and remaining boundaries.

## Architecture

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: FastAPI (Python) with scientific computing libraries
- **Database**: local Supabase (PostgreSQL + Auth + Storage)
- **State Management**: React Query + Zustand
- **File Handling**: Temporary job-based processing with Redis/in-memory caching

## Quick Start

### Prerequisites

- Node.js 22+
- Docker Desktop, Rancher Desktop, or another Docker-compatible runtime
- Python 3.12 or 3.13 recommended (3.10–3.13 supported)
- npm/yarn

### Installation

#### Quick Setup (Windows PowerShell)

```powershell
# Run the setup script
.\setup.ps1
```

#### Manual Setup

**Node.js Dependencies:**

```bash
npm install
npm run build:shared
```

**Python Backend Environment:**

```bash
# Windows Command Prompt
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..

# Windows PowerShell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..

# Linux/macOS
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

**Environment Configuration:**

```bash
# Copy and configure environment variables
cp .env.example .env
# Edit .env with your specific configuration
```

### Development

```bash
# Start the Docker-free local PostgreSQL-compatible database and frontend.
# The launcher selects the first free port from 3000 through 3010.
npm run dev:local

# Scientific FastAPI service, when IRMS processing is needed
npm run dev:frontend
npm run dev:backend
```

The frontend accesses FastAPI through `/backend-api/*`. Its own data routes remain under `/api/*`.

### Build

```bash
npm run build
```

## Project Structure

```
├── frontend/           # Next.js frontend application
├── backend/           # FastAPI backend application
├── shared/            # Shared types and utilities
├── docs/              # Documentation
└── scripts/           # Build and deployment scripts
```

## Features

- Real-time data processing and visualization
- Interactive calibration workflows
- Advanced diagnostic tools
- Client documents, results, credits, invoices, and reporting
- Consumables and spare-parts stock tracking
- Provider directory and purchasing lists
- Equipment, maintenance, calibration, incident, and backup records
- Unified operational work queue and laboratory pulse rail
- Scientific data format support
- Local-first Supabase migrations and seed data

## Development Guidelines

See `Documentation/IRMS_functionality_implementation_guidelines.md` for detailed implementation guidelines.

## IRMS Backend Endpoints

The backend implements IRMS XLS ingest, Information parsing, and diagnostic charts.

- XLS ingest from IRMS exports (.xlsx/.xls)
- Parsing of the `Information` column into structured numeric fields (acid_temp, leak_rate, p_no_acid, p_gases, total_co2, co2_after_exp, left/right mbar/pos, vm1_after_transfer)
- Diagnostic charts generation (7x3 grid) returned as Plotly JSON

Key modules:

- `backend/app/services/irms_ingest.py`
- `backend/app/services/diagnostics.py`
- `backend/app/services/state.py`
- `backend/app/api/endpoints/irms.py`

Run backend locally:

```
cd backend
uvicorn app.main:app --reload --port 8000
```

Or on Windows via batch script (recommended to auto-manage venv):

```
scripts\backend-start.bat
```

OpenAPI docs: `http://localhost:8000/api/v1/docs`

Example usage:

1. Process an IRMS Excel file

- Endpoint: `POST /api/v1/irms/process_irms`
- Multipart form-data with field `file` = IRMS Excel file.

Response:

```
{
  "job_id": "<uuid>",
  "digest": {
    "row_count": 123,
    "column_count": 45,
    "columns": ["..."],
    "identifiers": [{"Identifier 1": "...", "unique_samples": 10, "total_measurements": 20}],
    "ranges": {"d 13C/12C  Mean": {"min": -10.1, "max": -1.2}}
  }
}
```

2. Get Diagnostic Charts (Plotly JSON)

- Endpoint: `POST /api/v1/irms/diagnostics/figure`
- Body:

```
{
  "job_id": "<uuid>",
  "color_param": "Identifier 1",
  "identifiers": ["optional", "filter"],
  "d13c_range": [-8, 2],
  "d18o_range": [-10, 0]
}
```

Response: `{ "figure": "<plotly figure JSON string>" }`

## Client Manager (Clienti)

The frontend homepage now provides a Client Manager dashboard built with Next.js + shadcn + Tailwind and backed by Supabase.

### 1) Create Supabase tables

Run the SQL migration in your Supabase SQL editor:

`supabase/migrations/20260308_client_manager.sql`

### 2) Set environment variables

In `.env`, configure:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for server-side sync routes)
- `CLIENTI_FOLDER_PATH` (absolute path or relative path to `Clienti`)
- `RESULTS_FOLDER_PATH` (absolute path or relative path to `Results`)

### 3) Start the frontend

```bash
npm run dev:frontend
```

### 4) Sync data from folder

Open the homepage and click `Sync from Clienti`.

This calls `POST /api/client-manager/sync`, extracts documents from `Clienti`, and upserts `clients` + `client_documents` in Supabase.

## Results register and invoices

Open `/results` to process the `Results` folder or upload a result workbook. The filename is used to match or create the client, and workbook rows are indexed by Identifier 1, Identifier 2, and species for searching and scatter plotting.

Open `/clients` to view result workbooks separately from administrative files. Open `/finance` to manage invoice records, add clients, preview a branded bilingual PDF, and issue the final PDF into the corresponding client document record.

## Laboratory Knowledge Base

Open `/knowledge` to parse the archived conversations in `Merged_text_files`, monitor resumable ingestion jobs, manage indexed source versions, search evidence, and ask cited technical questions.

The knowledge store runs as filesystem-persisted PostgreSQL through PGlite with `pgvector`, PostgreSQL full-text search, and `pg_trgm`. It does not require Docker. Add `OPENAI_API_KEY` to `.env` to enable embeddings, enrichment, reranking, and grounded answer generation.

See [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) for processing guarantees, model choices, evaluation guidance, and the future Supabase migration path.
