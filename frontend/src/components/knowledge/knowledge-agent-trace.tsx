'use client';

import {
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  Search,
  Timer,
} from 'lucide-react';

import type { KnowledgeRetrievalTrace } from '@/lib/knowledge/types';

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

function stopLabel(reason: string) {
  const labels: Record<string, string> = {
    direct_answer: 'Direct evidence found',
    evidence_sufficient: 'Evidence judged sufficient',
    no_candidates: 'No matching evidence',
    no_follow_up_strategy: 'No useful search path remained',
    no_new_evidence: 'Follow-up search found nothing new',
    max_rounds: 'Search limit reached',
    evidence_assessment_error: 'Evidence review stopped early',
    reranking_disabled: 'Initial retrieval completed',
  };
  return labels[reason] ?? reason.replace(/_/g, ' ');
}

export function KnowledgeAgentTrace({
  trace,
}: {
  trace: KnowledgeRetrievalTrace;
}) {
  const totalMs = trace.retrievalMs + trace.generationMs;
  const followUpCount = Math.max(
    0,
    trace.queries.length - trace.initialQueries.length
  );

  return (
    <details
      open
      className="group/trace mt-4 overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50/40 dark:border-indigo-900 dark:bg-indigo-950/20"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40">
        <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md border border-indigo-200 bg-white text-indigo-600 shadow-sm dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
          <BrainCircuit className="h-3.5 w-3.5" />
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 ring-2 ring-indigo-50 dark:ring-indigo-950" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-100">
            Thinking trace
          </span>
          <span className="mt-0.5 block truncate font-mono text-[9px] text-slate-500 dark:text-slate-400">
            {trace.rounds.length} evidence reviews · {followUpCount} follow-up searches · {formatDuration(totalMs)}
          </span>
        </span>
        <span className="hidden rounded border border-indigo-200 bg-white/80 px-2 py-1 text-[9px] font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 sm:inline">
          {stopLabel(trace.stopReason)}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open/trace:rotate-180" />
      </summary>

      <div className="border-t border-indigo-200/80 bg-white/70 px-3 py-3 dark:border-indigo-900 dark:bg-slate-950/40">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950">
            <Search className="h-3.5 w-3.5 text-indigo-500" />
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
              Candidates
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {trace.initialCandidateCount} retrieved
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950">
            <FileSearch className="h-3.5 w-3.5 text-indigo-500" />
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
              Final evidence
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {trace.finalEvidenceCount} passages
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950">
            <Timer className="h-3.5 w-3.5 text-indigo-500" />
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-400">
              Retrieval
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {formatDuration(trace.retrievalMs)}
            </p>
          </div>
        </div>

        <section className="mt-3" aria-label="Search queries">
          <h4 className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Searches performed
          </h4>
          <ol className="mt-1.5 space-y-1">
            {trace.queries.map((query, index) => (
              <li
                key={`${query}-${index}`}
                className="flex gap-2 text-[11px] leading-4 text-slate-600 dark:text-slate-300"
              >
                <span className="mt-0.5 w-4 shrink-0 font-mono text-[9px] text-indigo-500">
                  {index + 1 < 10 ? `0${index + 1}` : index + 1}
                </span>
                <span>{query}</span>
              </li>
            ))}
          </ol>
        </section>

        {trace.rounds.length ? (
          <section className="mt-4" aria-label="Evidence review rounds">
            <h4 className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Search and review loop
            </h4>
            <div className="mt-2 space-y-2">
              {trace.rounds.map((round) => (
                <article
                  key={round.round}
                  className="relative border-l border-indigo-200 py-0.5 pl-4 dark:border-indigo-900"
                >
                  <span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-indigo-500 dark:border-slate-950" />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h5 className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      Review {round.round}
                    </h5>
                    <span className="font-mono text-[9px] text-slate-400">
                      {round.candidateCount} candidates
                      {round.confidence !== undefined
                        ? ` · ${Math.round(round.confidence * 100)}% confidence`
                        : ''}
                    </span>
                  </div>
                  {round.rationale ? (
                    <p className="mt-1 text-[11px] leading-4 text-slate-600 dark:text-slate-300">
                      {round.rationale}
                    </p>
                  ) : null}
                  {round.missingFacts.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {round.missingFacts.map((fact) => (
                        <span
                          key={fact}
                          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          Missing: {fact}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {round.followUpSearches.length ? (
                    <p className="mt-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                      Proposed follow-up: {round.followUpSearches
                        .map((search) => `“${search.query}” (${search.mode})`)
                        .join(' · ')}
                    </p>
                  ) : null}
                  {round.neighborChunkIds.length ? (
                    <p className="mt-1 font-mono text-[9px] text-indigo-600 dark:text-indigo-400">
                      Expanded nearby context for {round.neighborChunkIds
                        .map((id) => `[KB:${id}]`)
                        .join(' ')}
                    </p>
                  ) : null}
                  {round.addedChunkIds.length ? (
                    <p className="mt-1 font-mono text-[9px] text-emerald-700 dark:text-emerald-400">
                      Added {round.addedChunkIds.length} new passages: {round.addedChunkIds
                        .slice(0, 8)
                        .map((id) => `[KB:${id}]`)
                        .join(' ')}
                    </p>
                  ) : null}
                  {round.error ? (
                    <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                      {round.error}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          {trace.verificationSupported === false || trace.warnings.length ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          )}
          <div>
            <p className="font-semibold">{stopLabel(trace.stopReason)}</p>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              {trace.verificationSupported === true
                ? 'The final answer passed the citation and support check.'
                : trace.verificationSupported === false
                  ? 'The evidence check did not support a complete answer, so the response was limited.'
                  : 'No answer verification was needed because no final evidence was available.'}
            </p>
            {trace.warnings.map((warning) => (
              <p key={warning} className="mt-1 text-amber-700 dark:text-amber-300">
                {warning}
              </p>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
