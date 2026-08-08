# ISOGEOCHEM deterministic cleanup

The ISOGEOCHEM corpus is maintained in two separate filesystem layers:

- `Raw ISOGEOCHEM data/` is the immutable source corpus. It contains the 664 original text files and must never be used as a cleanup output.
- `Merged_text_files/` is the deterministic, embedding-ready corpus generated from the raw source.
- `cleanup_audit/` contains `manifest.json` and `decisions.jsonl`, which provide file hashes, aggregate results, and one cleanup decision for every parsed message.

All three directories are local runtime data and are excluded from Git. The cleaner and validator are version-controlled.

## Cleanup version

The current rule set is `isogeochem_cleanup_v1`. It:

1. removes quoted reply history and conventional signatures using the existing corpus parsing rules;
2. masks email addresses and phone-like values;
3. removes high-confidence subscription, confidentiality, and mail-client boilerplate lines;
4. removes contact-heavy institutional signature blocks at the end of messages;
5. quarantines job advertisements, event announcements, list administration, commercial postings, empty records, and narrowly recognized nontechnical exchanges;
6. retains uncertain records in a `review` lane instead of deleting them;
7. rescues short replies when their normalized subject belongs to a technical thread.

Quarantined content is absent from `Merged_text_files`, but its original record remains in `Raw ISOGEOCHEM data`. Each quarantine decision records the source filename, original ordinal and line range, stable ID, reasons, and signal counts.

## Current result

The 7 August 2026 run produced:

| Measure | Result |
| --- | ---: |
| Raw files | 664 |
| Cleaned files | 664 |
| Parsed raw messages | 46,259 |
| Retained technical/searchable messages | 36,028 |
| Retained review-lane messages | 4,798 |
| Quarantined messages | 5,433 |
| Quarantine rate | 11.74% |
| Parser-cleaned source characters | 74,243,021 |
| Searchable output characters | 51,105,668 |
| Post-parser character retention | 68.84% |
| Cleaned folder size | 60,803,977 bytes |

Quarantine reasons:

| Reason | Messages |
| --- | ---: |
| Job posting | 2,689 |
| Event announcement | 1,704 |
| Empty after deterministic parsing | 660 |
| List administration | 268 |
| Commercial posting | 99 |
| Nontechnical conversation | 13 |

## Rebuild

The cleaner refuses to overwrite an existing cleaned or audit directory. Move the existing generated directories aside before intentionally rebuilding.

```powershell
node scripts\clean-isogeochem-corpus.mjs
node scripts\validate-isogeochem-cleanup.mjs
```

The cleaner writes temporary sibling directories and promotes them only after all files have completed successfully. A failed run leaves the raw corpus untouched.

## Validation guarantees

The validator checks:

- all 664 raw SHA-256 hashes against the audit manifest;
- all 664 cleaned SHA-256 hashes;
- one unique audit decision for every parsed raw message;
- exact agreement between retained decisions and reparsed cleaned records;
- absence of quarantined subject genres from the cleaned corpus;
- absence of known strict boilerplate patterns.

The final validation status for this run is `passed`.

## Review before embeddings

The `review` lane is intentionally retained but uncertain. Before embedding the complete corpus, open `/knowledge`, choose **Review queue**, and select **Sync audit**. The page idempotently imports both the 4,798 uncertain records and the 5,433 records already quarantined by cleanup. Use the `Quarantined · reviewable` status filter to inspect rejected material. A reviewer can read each full message, open its raw source and original line range, inspect thread context, and choose **Keep for ingestion**, **Quarantine**, or **Decide later**.

The category navigator prioritizes the 4,798 uncertain records currently included in the cleaned corpus, then the higher-risk quarantine categories. Use **Select this page** to apply a bulk Keep or Quarantine decision to the 25 visible records after inspecting the category and sample contents. Bulk decisions remain reversible through the decision filter.

Use its filters to examine a stratified sample of:

- `lane = "review"`;
- each quarantine reason;
- the largest `excludedCharacters` values;
- short messages rescued through `technical_thread_context`.

If a rule changes, increment `CLEANUP_VERSION`, rebuild from the raw directory, validate again, and treat the cleaned files as new immutable source versions for ingestion.
