import { ClientManagerDashboard } from '@/components/client-manager-dashboard';

export default async function ClientsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams?: Promise<{ clientId?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  return (
    <ClientManagerDashboard initialClientId={searchParams?.clientId ?? null} />
  );
}
