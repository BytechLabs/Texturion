import Link from "next/link";

import { cn } from "@/lib/utils";

/** The JobText wordmark — text-based, petrol accent on the second half. */
export function Wordmark({
  href = "/inbox",
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-baseline text-lg font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      Job<span className="text-primary">Text</span>
    </Link>
  );
}
