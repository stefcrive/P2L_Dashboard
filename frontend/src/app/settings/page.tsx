import { InvoiceSettingsDashboard } from '@/components/invoice-settings-dashboard';
import { SettingsNavigation } from '@/components/settings-navigation';

export default function SettingsPage() {
  return (
    <>
      <SettingsNavigation />
      <InvoiceSettingsDashboard />
    </>
  );
}
