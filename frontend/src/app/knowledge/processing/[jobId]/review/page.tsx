import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/dashboard/primitives';
import { KnowledgeReviewQueue } from '@/components/knowledge/knowledge-review-queue';
import { Button } from '@/components/ui/button';

export default async function ProcessingJobReviewPage({
  params: paramsPromise,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const params = await paramsPromise;
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
        <Link
          href="/knowledge?tab=processing"
          className="hover:text-foreground"
        >
          Processing
        </Link>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span>Job #{params.jobId}</span>
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
        <span className="text-foreground">Review queue</span>
      </nav>

      <PageHeader
        eyebrow={`Processing job #${params.jobId}`}
        title="Review before embedding"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/knowledge?tab=processing">Back to processing</Link>
          </Button>
        }
      />

      <KnowledgeReviewQueue jobId={params.jobId} />
    </div>
  );
}
