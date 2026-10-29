import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { GeistMono } from 'geist/font/mono';
import 'katex/dist/katex.min.css';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/layout/app-shell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});


export const metadata: Metadata = {
  title: 'P2L Dashboard',
  description:
    'Client, document, materials, and laboratory operations dashboard for P2L',
  icons: {
    icon: {
      url: '/favicon.png',
      type: 'image/png',
      sizes: '512x512',
    },
    apple: {
      url: '/favicon.png',
      type: 'image/png',
      sizes: '512x512',
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${GeistMono.variable}`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{const t=localStorage.getItem('p2l-theme');const d=t==='dark';document.documentElement.classList.toggle('dark',d)}catch(e){}",
          }}
        />
        <Providers>
          <AppShell requireAuth={Boolean(process.env.VERCEL) || process.env.P2L_REQUIRE_AUTH === '1'}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
