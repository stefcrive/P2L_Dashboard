import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Keep page-level overrides (such as a flush p-0 table) compatible with the
// shared density tokens declared in tailwind.config.ts.
const twMerge = extendTailwindMerge({
  extend: { theme: { spacing: ['workspace', 'panel', 'control'] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
