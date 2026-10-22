'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';

interface ThemeProviderProps {
  children: ReactNode;
}

// Pages drawn for the dark only; the visitor's own setting is kept for every other page
const DARK_ONLY = new Set(['/halloween']);

export function ThemeProvider({ children }: ThemeProviderProps) {
  const pathname = usePathname();
  return (
    <NextThemesProvider
      forcedTheme={DARK_ONLY.has(pathname) ? 'dark' : undefined}
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
