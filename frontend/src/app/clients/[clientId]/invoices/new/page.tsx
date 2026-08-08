import { FinanceDashboard } from '@/components/operations/finance-dashboard';

export default function NewClientInvoicePage({
  params,
}: {
  params: { clientId: string };
}) {
  return <FinanceDashboard view="create" clientId={params.clientId} />;
}
