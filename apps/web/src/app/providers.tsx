"use client";

import { ThemeProvider } from "next-themes";

/**
 * Global providers — the only thing every route (marketing included) needs.
 * Kept to ThemeProvider alone so public pages carry no TanStack Query / tooltip
 * / toaster / service-worker weight (BLUEPRINT §11.4). The app-only stack lives
 * in app-providers.tsx and is mounted by the signed-in route groups.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
