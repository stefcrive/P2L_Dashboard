import { KnowledgeBaseDashboard } from '@/components/knowledge/knowledge-base-dashboard';

export default async function KnowledgePage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const requested = searchParams?.tab;
  const initialTab = (
    ['chat', 'ask', 'processing', 'review', 'engines', 'library'] as const
  ).find((tab) => tab === requested);
  return <KnowledgeBaseDashboard initialTab={initialTab} />;
}
