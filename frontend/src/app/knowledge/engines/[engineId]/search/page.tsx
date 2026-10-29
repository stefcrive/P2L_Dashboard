import { KnowledgeEngineSearch } from '@/components/knowledge/knowledge-engine-search';

export default async function EngineSearchPage({
  params: paramsPromise,
}: {
  params: Promise<{ engineId: string }>;
}) {
  const params = await paramsPromise;
  return <KnowledgeEngineSearch engineId={params.engineId} />;
}
