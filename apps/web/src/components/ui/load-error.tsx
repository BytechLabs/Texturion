"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #733: the one "couldn't load this" state. A plain sentence and an outline
 * Retry, as a card among other cards (`card`) or centred in the space the
 * content would have filled (`fill`). A not-found page passes its own `action`
 * (back to the list) instead of Retry, since retrying will not find it.
 */
export function LoadError({
  message,
  onRetry,
  action,
  variant = "card",
  className,
}: {
  /** Defaults to the general "Couldn't load this" sentence. */
  message?: string;
  onRetry?: () => void;
  /** Replaces Retry, for a state retrying cannot fix. */
  action?: React.ReactNode;
  variant?: "card" | "fill";
  className?: string;
}) {
  const t = useT();
  const next =
    action ??
    (onRetry ? (
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    ) : null);
  return (
    <div
      role="alert"
      className={cn(
        variant === "card"
          ? "flex flex-col items-start gap-3 rounded-app-card border border-app-line bg-app-paper px-4 py-4"
          : "flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <p className="text-sm text-app-muted">{message ?? t("common.loadFailed")}</p>
      {next}
    </div>
  );
}
