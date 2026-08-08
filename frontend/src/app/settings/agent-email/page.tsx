import { GmailConnectionDashboard } from '@/components/gmail-connection-dashboard';
import { SettingsNavigation } from '@/components/settings-navigation';

export default function AgentEmailSettingsPage() {
  return (
    <>
      <SettingsNavigation />
      <GmailConnectionDashboard />
    </>
  );
}
