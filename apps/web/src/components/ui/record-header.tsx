import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * #717: the one header every record panel and detail page draws: who or what
 * this is, what it says about itself, and an action row under it. Navigation
 * to the record's own page is a labelled link in that row, never an icon in a
 * corner, so it cannot be mistaken for editing and is found on first look.
 */
export function RecordHeader({
  leading,
  title,
  meta,
  trailing,
  actions,
  className,
}: {
  /** An avatar, or a task's done circle. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Quiet lines under the title: a number, an outcome, a relationship. */
  meta?: React.ReactNode;
  /** Icon toggles and the ⋯ menu, beside the title. */
  trailing?: React.ReactNode;
  /** The action row: copy, call, open. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1 space-y-0.5">
          {title}
          {meta}
        </div>
        {trailing && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {trailing}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </header>
  );
}

/** The action row's way to the record's own page, at the row's far end. */
export function RecordOpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="ml-auto gap-0.5 pr-1.5 text-app-olive hover:text-app-olive-deep"
    >
      <Link href={href}>
        {label}
        <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
      </Link>
    </Button>
  );
}

/** One section of a record panel: a quiet label over its content. */
export function RecordSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="space-y-1.5">
      <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-app-muted-2">
        {label}
      </h3>
      {children}
    </section>
  );
}
