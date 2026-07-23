import Link from "next/link";

import { golosText } from "@/lib/app/fonts";
import { cn } from "@/lib/utils";

/**
 * The Loonext wordmark (#206, brand/README.md): Golos Text SemiBold with the
 * SECOND o in the brand accent — olive #66801F on light surfaces, lime
 * #B9CF57 in dark. Always exactly the second o, always text spans, never an
 * image. Mounts the Golos variable itself so the face holds on surfaces
 * outside the (app) scope (auth, onboarding).
 */
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
        golosText.variable,
        "inline-flex items-baseline text-lg font-semibold tracking-tight text-foreground [font-family:var(--font-golos),system-ui,sans-serif]",
        className,
      )}
    >
      Lo<span className="text-[#66801F] dark:text-[#B9CF57]">o</span>next
    </Link>
  );
}
