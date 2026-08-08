# Laboratory Knowledge Base

The Knowledge Base turns laboratory conversations and documents into a local, cited retrieval system. It accepts text, Markdown, CSV, TSV, XLS, XLSX, and text-based PDF files. It uses PGlite, a filesystem-persisted PostgreSQL build, so it requires neither Docker nor a separately installed PostgreSQL service. The schema uses ordinary PostgreSQL, `pgvector`, full-text search, and `pg_trgm` so it can be migrated to Supabase later.

## Start here

1. Add `OPENAI_API_KEY` to the repository `.env` file. Parse-only jobs and keyword evidence search work without a key; embeddings, enrichment, reranking, and answer generation require one.
2. Start the existing application.
3. Open `/knowledge`.
4. In **Processing**, upload one or more documents or open the advanced path control to use an existing workspace file/folder.
5. Choose a mode:
   - **Extract only** preserves and structures content without API calls.
   - **Searchable** adds embeddings and is the recommended RAG baseline.
   - **Enriched** also derives classification and short indexing metadata with a selected LLM.
6. For an unfamiliar or noisy collection, run **Extract only**, open **Review queue**, and resolve uncertain messages before starting a Searchable or Enriched pass.
7. Leave **Start processing immediately** enabled unless the batch needs inspection first.
8. Keep the first production experiment at 600 target tokens and 90 overlap tokens, then tune with an evaluation set rather than by intuition.

The local database defaults to `.local-data/knowledge-postgres` and is excluded from Git. Change it with `KNOWLEDGE_DB_PATH`.

For the ISOGEOCHEM archive, `Merged_text_files/` now contains the deterministic cleaned corpus. The untouched 664-file source is preserved in `Raw ISOGEOCHEM data/`, and every retained or quarantined message is recorded in `cleanup_audit/`. See [ISOGEOCHEM deterministic cleanup](./ISOGEOCHEM_DATA_CLEANUP.md) before rebuilding or starting full-corpus embeddings.

## Processing guarantees

- A SHA-256 checksum identifies every immutable source version.
- Raw bodies, original headers, parsed dates, offsets, and source line ranges are retained.
- Email addresses and phone-like values are masked before text is sent to an embedding or generation model.
- Reply history and signatures are separated from the new analyst contribution.
- Subjects are normalized into stable thread keys.
- Product, component, technology, method, isotope, acronym, and error-code metadata is extracted deterministically.
- Enrichment output is labeled as derived metadata and is never supplied as answer evidence.
- Chunks follow paragraphs and sentences, preserve message context, and retain precise source lines.
- Jobs checkpoint every file. Duplicate source/model/parser/chunk configurations are skipped by checksum.
- New active jobs with identical paths, models, and chunk settings are deduplicated before insertion.
- Evidence cards show their entire retrieved passage in a scrollable region and link to the immutable original source file.

## Human review queue

The **Review queue** is a persistent decision layer shared by the existing ISOGEOCHEM cleanup and all future ingestion jobs.

- **Sync audit** imports both the retained `review` lane and the already-quarantined lane from `cleanup_audit/decisions.jsonl`. Importing is idempotent, so it is safe to repeat after a cleanup rebuild.
- New ingestion jobs deterministically flag administrative genres, uncertain relevance, parser warnings, and nontechnical enrichment results.
- Reviewers can search and filter the queue, read the complete scrollable message, open the raw source text, inspect related thread context, and record a decision note.
- The queue is organized by review risk: uncertain retained content first, followed by empty-after-parsing, commercial, event, job, list-administration, and nontechnical categories. Category rows show the full audit count and rationale and open an exact reason filter across all decision states.
- **Keep for ingestion** retains or restores the message. **Quarantine** removes linked chunks from every retrieval path immediately. **Decide later** records that the item was seen without making a retrieval decision. Audit quarantines remain available under the `Quarantined · reviewable` status filter, and changing one to Keep admits it when `Raw ISOGEOCHEM data/` is next processed.
- Reviewers can select individual messages or all 25 records on the visible page and apply **Keep selected** or **Quarantine selected**. Bulk quarantine requires confirmation, is limited to 200 records by the API, and records a shared category-aware audit note.
- When the same source is processed again, matching quarantined content is filtered by source ordinal plus content fingerprint before enrichment and embedding. This avoids paying to process rejected content while preventing an ordinal-only decision from hiding changed text.

The recommended workflow for noisy sources is:

```text
Upload → Extract only → Review uncertain messages → Searchable/Enriched pass
```

Review decisions live in `kb.review_items`. The portable migration is [`database/knowledge/002_review_queue.sql`](../database/knowledge/002_review_queue.sql).

## Current document extraction

- TXT and Markdown files are checked for the merged-conversation format. Ordinary text documents fall back to a single structured document record.
- CSV, TSV, XLS, and XLSX files are converted into sheet-labelled Markdown tables before chunking.
- PDFs use local text extraction. This works for PDFs with a usable text layer.
- Scanned PDFs, figures, charts, page geometry, and embedded images are not yet converted into retrievable visual evidence. These sources are marked with warnings rather than pretending extraction was complete.

Uploaded batches are copied to `.local-data/knowledge-uploads/<batch-id>` so their source links remain stable after the browser upload has finished.

## Retrieval and answers

The first pass retrieves up to 40 candidates from:

1. cosine similarity over `vector(1024)`;
2. weighted PostgreSQL full-text search, with a broad OR fallback for recall;
3. trigram-backed exact technical identifiers.

The lists are fused with Reciprocal Rank Fusion. At most two chunks per message survive the diversity pass. An LLM reranker then selects answer evidence. If it determines a necessary fact is missing, the system can execute one focused refinement query before generating the answer.

The answer prompt permits only retrieved evidence, requires inline `[KB:<chunk-id>]` citations, exposes conflicts and dates, and requires abstention when the archive is insufficient. Query traces store retrieved IDs, cited IDs, latency, refinement state, and abstention.

## Model choices

- `gpt-5.6-luna`: default enrichment choice for high-volume extraction.
- `gpt-5.6-terra`: default answer/rerank choice for balanced quality and throughput.
- `gpt-5.6-sol`: quality-first option for the hardest synthesis questions.
- `text-embedding-3-small`: economical default embedding model.
- `text-embedding-3-large`: higher-quality alternative.

Both embedding options are requested at 1,024 dimensions to keep one portable vector schema. Changing the embedding model causes a source to be reprocessed rather than mixing models silently.

## Layout-aware PDF and visual evidence with Docling

Docling is the recommended next extraction layer, but it is intentionally not a hidden dependency of the current Node process. Run it in a Python worker or container so its native and model dependencies do not slow the dashboard:

1. The upload job writes an immutable source and checksum.
2. A Docling worker exports canonical Markdown, structured JSON, page numbers, reading order, tables, figure crops, and bounding boxes.
3. Native tables become Markdown/JSON chunks with page and bounding-box provenance.
4. Each meaningful figure or chart crop is stored as an asset. OCR and a vision pass produce a searchable description containing the title, axes, units, legend, visible trend, and any readable values.
5. Every derived visual description stores `source_id`, page, bounding box, crop hash, extraction model, prompt version, and confidence. Retrieval displays both the crop and an **Open original page** link.
6. The answer generator may use the description to find the asset, but a visual claim must cite that asset/page. The generated description is derived evidence, not a replacement for the original image.

A practical schema extension is:

- `kb.visual_assets`: source, page, bounding box, MIME type, crop path/hash, OCR, caption, structured chart data, model/prompt versions;
- `kb.document_blocks`: Docling block ID, kind, reading order, page/bounding box, Markdown, raw JSON, and source offsets;
- a vector column on the combined caption/OCR/table representation.

For charts, prefer extracted table data when Docling can recover it. When only pixels exist, retain the image and describe it with GPT-5.6 Luna vision; do not invent exact plotted values that are not readable. A later chart-digitisation tool can add approximate series values under a clearly labelled `derived_estimate` field.

## Secondary structured Markdown memory

A higher-level memory layer is feasible and should be additive, never authoritative. Its job is to make cross-document synthesis easier without weakening citations.

Recommended flow:

1. Group raw chunks by stable topic/entity/thread, not by arbitrary batch size.
2. Have Luna generate one versioned Markdown memory file per topic using a strict template: scope, terminology, equipment/models, procedures, failure modes, decisions, conflicts, timeline, open questions, and source chunk IDs.
3. Split statements into `memory claims`, each carrying the exact supporting raw chunk IDs. Claims without support are rejected.
4. Embed the Markdown sections in a separate memory index.
5. At query time, retrieve memory first to identify relevant topics and terminology, then retrieve the underlying raw chunks. Final answers cite raw chunks or visual assets; memory is a routing and synthesis aid.
6. Invalidate only memory files touched by a changed source checksum. Keep generator model, prompt version, creation date, and source hashes in YAML front matter.

Example front matter:

```yaml
memory_id: irms-delta13c-stability
generated_by: gpt-5.6-luna
prompt_version: memory-v1
source_chunks: [123, 128, 405]
source_hashes: [sha256:...]
status: derived
```

This layer can improve answers that require terminology normalization, long timelines, repeated troubleshooting patterns, or synthesis across many conversations. It also introduces staleness and hallucination risk, so it needs claim-level provenance, incremental rebuilds, and evaluation against the raw-only baseline.

## Token and cost model

Rates below are direct OpenAI API standard pricing as of 7 August 2026. Check the live [OpenAI API pricing page](https://developers.openai.com/api/docs/pricing) before a large run. GPT-5.6 Luna is currently `$0.20 / 1M` short-context input tokens, `$0.02 / 1M` cached input tokens, `$0.25 / 1M` cache-write tokens, and `$1.20 / 1M` output tokens. `text-embedding-3-small` is `$0.02 / 1M` input tokens. The [Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna) notes that requests above 272K input tokens are billed at 2× input and 1.5× output for the full request.

Use actual API usage fields for accounting. The estimates shown in the UI use file bytes ÷ 4 only as a pre-extraction preview; compressed spreadsheets and PDFs can be far from that estimate.

For `S` extracted source tokens:

```text
embedding_tokens ≈ S × target / (target - overlap)
embedding_cost = embedding_tokens / 1,000,000 × embedding_rate

Luna_cost = input_tokens / 1,000,000 × 0.20
          + output_tokens / 1,000,000 × 1.20
```

At the default 600-token target and 90-token overlap, the embedding multiplier is `600 / 510 = 1.176`. One million extracted tokens therefore costs about `$0.024` to embed with `text-embedding-3-small`.

Illustrative direct-API budget for one million extracted tokens:

| Work                      | Assumption                                          | Approximate cost |
| ------------------------- | --------------------------------------------------- | ---------------: |
| Raw searchable index      | 1.176M embedding tokens                             |           $0.024 |
| Current Luna enrichment   | 1.0M input + 0.10M output                           |           $0.320 |
| Secondary Markdown memory | 1.0M input + 0.15M output + 0.15M memory embeddings |           $0.383 |
| All three layers          | Sum of the rows above                               |           $0.727 |

These are planning numbers, not a quote. Prompt overhead, reasoning tokens, retries, PDF OCR/vision inputs, and output length increase usage. The current code calls the standard Responses and Embeddings endpoints. Offline enrichment and memory builds could move to the Batch API, whose listed Luna token rates are 50% lower, but that requires a separate asynchronous submission/reconciliation worker. Keep each request below the 272K long-context threshold by processing bounded topics or document sections.

## Supabase migration

The portable migration is [`database/knowledge/001_initial.sql`](../database/knowledge/001_initial.sql). For the future move:

1. Enable `vector` and `pg_trgm` in the Supabase project.
2. Apply the migration with the Supabase CLI or SQL migration workflow.
3. Export the local `kb` tables and import them into the project.
4. Replace the PGlite data adapter with a server-only pooled PostgreSQL/Supabase adapter.
5. Keep `kb` private; expose only narrowly scoped RPCs or server endpoints, with RLS/roles appropriate to the lab.
6. Rebuild the HNSW index after a large bulk load if that is faster than maintaining it during import.

Do not expose raw analyst conversations through a public Data API schema.

## Evaluation before full ingestion

Create a versioned set of 100–300 questions with expected passages. Include lookups, error codes, multi-message synthesis, version-specific questions, conflicts, and intentionally unanswerable questions. Record:

- retrieval Recall@K and Precision@K;
- NDCG/ranking quality;
- answer groundedness and completeness;
- citation support and location correctness;
- conflict reporting;
- abstention accuracy.

Run a small indexed sample first, review false positives and missed passages, then ingest the complete corpus.
