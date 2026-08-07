# Laboratory Knowledge Base

The Knowledge Base turns `Merged_text_files` into a local, cited retrieval system. It uses PGlite, a filesystem-persisted PostgreSQL build, so it requires neither Docker nor a separately installed PostgreSQL service. The schema uses ordinary PostgreSQL, `pgvector`, full-text search, and `pg_trgm` so it can be migrated to Supabase later.

## Start here

1. Add `OPENAI_API_KEY` to the repository `.env` file. Parse-only jobs and keyword evidence search work without a key; embeddings, enrichment, reranking, and answer generation require one.
2. Start the existing application.
3. Open `/knowledge`.
4. In **Processing**, leave the source as `Merged_text_files` and choose a mode:
   - **Parse only** preserves and structures messages without API calls.
   - **Indexed** adds embeddings and is the recommended RAG baseline.
   - **Enriched** also derives classification and short indexing metadata with a selected LLM.
5. Keep the first production experiment at 600 target tokens and 90 overlap tokens, then tune with an evaluation set rather than by intuition.

The local database defaults to `.local-data/knowledge-postgres` and is excluded from Git. Change it with `KNOWLEDGE_DB_PATH`.

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
