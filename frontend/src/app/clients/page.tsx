import { ClientManagerDashboard } from '@/components/client-manager-dashboard';

export default function ClientsPage({
  searchParams,
}: {
  searchParams?: { clientId?: string };
}) {
  return (
    <ClientManagerDashboard initialClientId={searchParams?.clientId ?? null} />
  );
}
