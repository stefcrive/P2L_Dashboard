import { ChevronRight, ExternalLink, FileText } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { getKnowledgePassage } from '@/lib/knowledge/retrieval';

export const dynamic = 'force-dynamic';

export default async function KnowledgePassagePage({
  params: paramsPromise,
}: {
  params: Promise<{ chunkId: string }>;
}) {
  const params = await paramsPromise;
  const passage = await getKnowledgePassage(Number(params.chunkId));
  if (!passage) notFound();

  return (
    <div className="space-y-workspace">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-muted-foreground"
      >
        <Link href="/knowledge" className="hover:text-foreground">
          Knowledge engine
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="max-w-72 truncate">{passage.sourceName}</span>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground">KB:{passage.chunkId}</span>
      </nav>

      <PageHeader
        eyebrow={`Knowledge passage · KB:${passage.chunkId}`}
        title={passage.subject || passage.sourceName}
        actions={
          <Button asChild size="sm" variant="outline">
            <a
              href={`/api/knowledge/sources/${passage.sourceId}/content`}
              target="_blank"
              rel="noreferrer"
            >
              Open source document
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        }
      />

      <SectionPanel
        title="Indexed passage"
        description={`${passage.sourceName} · lines ${passage.startLine}–${passage.endLine}`}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {passage.engineNames.map((engine) => (
              <StatusPill key={engine} tone="primary">
                {engine}
              </StatusPill>
            ))}
          </div>
        }
      >
        <div className="mb-4 flex items-start gap-2 border-b pb-4 text-[11px] text-muted-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p>{passage.author || 'Unknown author'}</p>
            <p
              className="mt-1 truncate font-mono text-[9px]"
              title={passage.sourcePath}
            >
              {passage.sourcePath}
            </p>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
          {passage.content}
        </p>
      </SectionPanel>
    </div>
  );
}
