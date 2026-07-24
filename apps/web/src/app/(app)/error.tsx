"use client";

import { RotateCw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

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
  useEffect(() => {
    // Surface it for the browser console; the digest is the server-correlated
    // id Next.js assigns. Also ship it to Sentry — an authenticated-surface
    // crash caught here would otherwise stay invisible to us (only the global
    // and root boundaries reported before).
    console.error("App segment error", error);
    void reportBoundaryError(error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="max-w-sm space-y-1.5">
        <p className="text-base font-semibold text-app-ink">
          This screen ran into a problem.
        </p>
        <p className="text-sm text-app-muted">
          The rest of the app is fine. You can try this screen again or move on
          from the sidebar.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
        Try again
      </Button>
    </div>
  );
}
