import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A calm placeholder surface for a nav destination whose full experience lands
 * in a later wave (APP-LAYOUT-V2 §6 — /for-you (D23), /tasks (D25)). It exists
 * so every nav link resolves to a real, honest page (zero dead links, §1.3),
 * never a 404, and always offers the way back into the working inbox so the
 * surface is never a dead end.
 *
 * Quiet by design: one hero line, one plain sentence, one neutral action — the
 * Wealthsimple-calm restraint the rest of the app keeps. The later features
 * wave replaces the whole page at this route.
 */
export function ComingSoon({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon
          className="size-6 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/inbox">Back to inbox</Link>
      </Button>
    </div>
  );
}
