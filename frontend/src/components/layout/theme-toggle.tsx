'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    document.documentElement.classList.toggle('dark', nextDark);
    localStorage.setItem('p2l-theme', nextDark ? 'dark' : 'light');
    setDark(nextDark);
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={toggleTheme}
      aria-label={dark ? 'Use light theme' : 'Use dark theme'}
      title={dark ? 'Use light theme' : 'Use dark theme'}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
