"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";

import { ServiceWorkerRegistrar } from "@/components/notifications/service-worker-registrar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/error";
import { reportClientError } from "@/lib/observability/sentry";

/**
 * A client-side failure worth reporting to Sentry (D13): an unexpected server
 * 5xx, or a network / CORS error (not an ApiError at all). Expected 4xx (auth,
 * conflict, validation, not-found) are normal UX and stay out of Sentry.
 */
function isReportable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/**
 * One QueryClient per browser tab. Defaults follow G12: realtime keeps data
 * fresh, so queries stay quiet unless explicitly invalidated; auth/permission
 * failures never retry (a second attempt cannot succeed).
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    // Surface unexpected query/mutation failures to Sentry so a client 5xx or a
    // blocked/CORS request is observable, not just swallowed by a toast.
    queryCache: new QueryCache({
      onError: (error) => {
        if (isReportable(error)) reportClientError(error, { source: "query" });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isReportable(error)) {
          reportClientError(error, { source: "mutation" });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.retryable) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * The signed-in-product provider stack: TanStack Query, tooltips, toasts, and
 * the service-worker registrar. Mounted only by the app-facing route groups
 * ((app), (auth), onboarding, dashboard) — never by the (marketing) group, so
 * public pages ship none of this client weight above the fold (BLUEPRINT §11.4).
 *
 * ThemeProvider is deliberately NOT here: it stays global in the root layout so
 * dark mode works on marketing pages too (the dark band, the theme toggle).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      {/* Sonner, quiet, bottom-left (G9/G12) — only for async outcomes not
          visible in place. */}
      <Toaster position="bottom-left" />
      {/* /sw.js registration (G9: push + offline shell). Render-null and
          prompt-free — permission requests stay in settings (G8). PWA is an
          app concern; marketing pages don't register a worker. */}
      <ServiceWorkerRegistrar />
    </QueryClientProvider>
  );
}
