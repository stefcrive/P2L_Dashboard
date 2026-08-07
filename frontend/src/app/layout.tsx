import type { Metadata } from 'next';
import { Manrope, Space_Grotesk } from 'next/font/google';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/layout/app-shell';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'P2L Dashboard',
  description:
    'Client, document, materials, and laboratory operations dashboard for P2L',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${manrope.variable} ${spaceGrotesk.variable} ${GeistMono.variable}`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{const t=localStorage.getItem('p2l-theme');const d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}",
          }}
        />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
