import { FinanceDashboard } from '@/components/operations/finance-dashboard';

export default async function NewClientQuotationPage({
  params: paramsPromise,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const params = await paramsPromise;
  return (
    <FinanceDashboard
      key={params.clientId}
      view="quotation"
      clientId={params.clientId}
    />
  );
}
