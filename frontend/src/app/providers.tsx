'use client';

import dynamic from 'next/dynamic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const TradingChatAssistant = dynamic(
  () =>
    import('@/components/chat/trading-chat-assistant').then(
      (module) => module.TradingChatAssistant
    ),
  { ssr: false }
);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <TradingChatAssistant />
    </QueryClientProvider>
  );
}
