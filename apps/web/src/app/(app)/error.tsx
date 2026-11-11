"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { EmptyState } from "@/components/ui/empty-state";

import { reportBoundaryError } from "../error";

/**
 * The (app) route-segment error boundary. A single crashing component
 * (a v1-shaped /v1/search payload, a malformed realtime frame, any render
 * throw) is caught HERE instead of tearing the whole shell down — the sidebar
 * and nav stay mounted (the boundary sits inside `(app)/layout.tsx`), and this
 * calm panel offers one honest recovery: try the screen again.
 *
 * `reset()` re-renders the errored segment; a hard crash that survives a retry
 * still leaves the user their navigation to move elsewhere.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    // Surface it for the browser console; the digest is the server-correlated
    // id Next.js assigns. Also ship it to PostHog: an authenticated-surface
    // crash caught here would otherwise stay invisible to us (only the global
    // and root boundaries reported before).
    console.error("App segment error", error);
    void reportBoundaryError(error);
  }, [error]);

  return (
    <EmptyState
      className="min-h-full flex-1"
      title={t("appShell.segmentErrorTitle")}
      description={t("appShell.segmentErrorBody")}
      action={
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
          {t("common.retry")}
        </Button>
      }
    />
  );
}
