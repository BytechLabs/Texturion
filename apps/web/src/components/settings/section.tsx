import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Shared scaffolding for every settings detail page (G8): mobile back link
 * to the stacked section list, page heading, and bordered cards (no shadows —
 * G2 border-first surfaces).
 */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/settings"
          className="mb-2 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          Settings
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      {(title || description) && (
        <div className="space-y-1 border-b px-4 py-3 sm:px-5">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
      {footer && (
        <div className="border-t bg-muted/30 px-4 py-3 sm:px-5">{footer}</div>
      )}
    </section>
  );
}

/** Inline error with a retry — the shared query-failure state. */
export function LoadError({
  message = "Couldn't load this. Check your connection and try again.",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border bg-card px-4 py-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Try again
      </button>
    </div>
  );
}
