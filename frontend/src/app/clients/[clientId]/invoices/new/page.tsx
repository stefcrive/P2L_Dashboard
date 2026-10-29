import { FinanceDashboard } from '@/components/operations/finance-dashboard';

export default async function NewClientInvoicePage({
  params: paramsPromise,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const params = await paramsPromise;
  return <FinanceDashboard view="create" clientId={params.clientId} />;
}
