'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Mail, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';

const items = [
  { href: '/settings', label: 'Invoice defaults', icon: FileText },
  { href: '/settings/agent-email', label: 'Agent email', icon: Mail },
  { href: '/settings/equipment', label: 'Equipment portfolio', icon: Wrench },
] as const;

export function SettingsNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      className="mb-3 flex w-full gap-1 overflow-x-auto rounded-lg border bg-muted/35 p-1 sm:w-fit"
    >
      {items.map((item) => {
        const active =
          item.href === '/settings'
            ? pathname === '/settings'
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-primary text-primary-foreground hover:text-primary-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
