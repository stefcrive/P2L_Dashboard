'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ExternalLink,
  FileEdit,
  Inbox,
  LockKeyhole,
  Mail,
  Search,
  Send,
  Unplug,
} from 'lucide-react';

import {
  EmptyState,
  PageHeader,
  SectionPanel,
  StatusPill,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';

type GmailStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  capabilities: string[];
  missingConfiguration: string[];
};

async function loadStatus(): Promise<GmailStatus> {
  const response = await fetch('/api/integrations/gmail', { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Gmail status could not be loaded.');
  return payload.data;
}

const capabilities = [
  {
    title: 'Search',
    description: 'Find conversations using the same query syntax as Gmail.',
    icon: Search,
  },
  {
    title: 'Read',
    description: 'Open message content and see sender, recipients, and attachments.',
    icon: Inbox,
  },
  {
    title: 'Write',
    description: 'Prepare drafts for review before anything leaves the mailbox.',
    icon: FileEdit,
  },
  {
    title: 'Send',
    description: 'Send only when you explicitly tell the agent to do so.',
    icon: Send,
  },
] as const;

function GoogleMailMark() {
  return (
    <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-slate-950">
      <Mail className="h-5 w-5 text-slate-700 dark:text-slate-200" aria-hidden="true" />
      <span className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#4285f4_0_25%,#ea4335_25%_50%,#fbbc04_50%_75%,#34a853_75%)]" />
    </div>
  );
}

export function GmailConnectionDashboard() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const statusQuery = useQuery({
    queryKey: ['gmail-connection'],
    queryFn: loadStatus,
    retry: false,
  });

  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get('gmail');
    if (!state) return;
    const messages: Record<string, { text: string; error: boolean }> = {
      connected: { text: 'Gmail connected. The agent can now work with this mailbox.', error: false },
      denied: { text: 'Google access was not granted. No account was connected.', error: true },
      'invalid-state': { text: 'The connection request expired. Start the connection again.', error: true },
      error: { text: 'Google authorization could not be completed. Check the OAuth setup and try again.', error: true },
      'not-configured': { text: 'Add the Google OAuth configuration before connecting an account.', error: true },
    };
    const next = messages[state];
    if (next) {
      setMessage(next.text);
      setMessageIsError(next.error);
    }
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/gmail', { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'Gmail could not be disconnected.');
      return payload.message as string;
    },
    onSuccess: async (nextMessage) => {
      setMessage(nextMessage);
      setMessageIsError(false);
      await queryClient.invalidateQueries({ queryKey: ['gmail-connection'] });
    },
    onError: (error: Error) => {
      setMessage(error.message);
      setMessageIsError(true);
    },
  });

  if (statusQuery.isError) {
    return (
      <EmptyState
        error
        title="Gmail settings could not be loaded"
        description={(statusQuery.error as Error).message}
      />
    );
  }

  const status = statusQuery.data;
  const connected = Boolean(status?.connected);
  const configured = Boolean(status?.configured);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Agent integration"
        title="Agent email"
        description="Connect one Gmail mailbox so the P2L agent can find correspondence, read context, prepare replies, and send only on request."
        actions={
          <StatusPill tone={connected ? 'success' : configured ? 'warning' : 'neutral'}>
            {statusQuery.isLoading
              ? 'Checking connection'
              : connected
                ? 'Gmail connected'
                : configured
                  ? 'Ready to connect'
                  : 'Setup required'}
          </StatusPill>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
        <SectionPanel
          title="Gmail account"
          description="The agent uses this account only when an email task calls for it."
          bodyClassName="p-0"
        >
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3.5">
              <GoogleMailMark />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {connected ? status?.email : 'No Gmail account connected'}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {connected
                    ? 'Available to the agent for search, reading, drafts, and explicit sends.'
                    : configured
                      ? 'Sign in with Google and review the requested mailbox permission.'
                      : 'Google OAuth credentials are needed before an account can be linked.'}
                </p>
              </div>
            </div>
            {connected ? (
              <Button
                variant="outline"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unplug className="mr-1.5 h-4 w-4" />
                {disconnectMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : (
              <Button asChild={configured} disabled={!configured || statusQuery.isLoading}>
                {configured ? (
                  <a href="/api/integrations/gmail/connect">
                    Connect Gmail
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span>Connect Gmail</span>
                )}
              </Button>
            )}
          </div>

          <div className="grid border-t sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
            {capabilities.map(({ title, description, icon: Icon }, index) => (
              <div
                key={title}
                className={`p-4 ${index > 0 ? 'border-t sm:border-t-0' : ''} ${index === 2 ? 'sm:border-t lg:border-t-0' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <p className="text-xs font-semibold">{title}</p>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Access boundaries"
          description="What connecting this mailbox permits."
        >
          <ul className="space-y-3 text-xs">
            <li className="flex gap-2.5">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>Gmail search, message content, drafts, and sending are included.</span>
            </li>
            <li className="flex gap-2.5">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>OAuth tokens stay encrypted in the server-side application database.</span>
            </li>
            <li className="flex gap-2.5">
              <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>The agent may create drafts, but sends only after an explicit instruction.</span>
            </li>
          </ul>
          <div className="mt-4 rounded-md border bg-muted/35 p-3">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
              Try in the assistant
            </p>
            <p className="mt-1.5 text-xs leading-5">
              “Find the latest email from our isotope standard supplier and draft a reply asking for lead time.”
            </p>
          </div>
        </SectionPanel>
      </div>

      {!configured && status ? (
        <SectionPanel
          title="Finish Google setup"
          description="Add a Web application OAuth client, enable the Gmail API, and register the callback URL."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <p className="text-xs leading-5 text-muted-foreground">
                Add the missing server variables, then restart the application. Use
                <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  http://localhost:3000/api/integrations/gmail/callback
                </span>
                as the authorized redirect URI for local development.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {status.missingConfiguration.map((name) => (
                  <code key={name} className="rounded border bg-background px-2 py-1 text-[10px]">
                    {name}
                  </code>
                ))}
              </div>
            </div>
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-2.5 text-xs font-semibold shadow-sm hover:bg-accent"
            >
              Google Cloud Console
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </div>
        </SectionPanel>
      ) : null}

      <p
        className={`min-h-5 text-xs ${messageIsError ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
        role={messageIsError ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message || (connected ? 'The connected mailbox is ready for agent email tasks.' : '')}
      </p>
    </div>
  );
}
