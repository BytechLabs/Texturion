"use client";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #733: the one "couldn't load this" state. A plain sentence and an outline
 * Retry, as a card among other cards (`card`) or centred in the space the
 * content would have filled (`fill`). A not-found page passes its own `action`
 * (back to the list) instead of Retry, since retrying will not find it.
 * `inline` is one line, the sentence beside a small Retry, for a spot inside a
 * card that has no room for a card of its own.
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
  variant?: "card" | "fill" | "inline";
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
        variant === "card" &&
          "flex flex-col items-start gap-3 rounded-app-card border border-app-line bg-app-paper px-4 py-4",
        variant === "fill" &&
          "flex flex-1 flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        variant === "inline" && "flex flex-wrap items-center gap-x-3 gap-y-1",
        className,
      )}
    >
      <p
        className={cn(
          "text-app-muted",
          variant === "inline" ? "text-[13px]" : "text-sm",
        )}
      >
        {message ?? t("common.loadFailed")}
      </p>
      {next}
    </div>
  );
}
