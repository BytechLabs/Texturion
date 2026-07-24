"use client";

import { useEffect, useState } from "react";

import type { LastUsedMethod } from "@/lib/auth/last-used";
import { readSignInMethod } from "@/lib/auth/last-used";
import { cn } from "@/lib/utils";

/**
 * Reads the remembered sign-in method AFTER mount.
 *
 * localStorage does not exist during the server render, so reading it during
 * render would either crash or produce markup that disagrees with the client
 * and gets thrown away. Starting at null and filling in on mount means the
 * badge simply appears a beat later, which is right for a hint.
 */
export function useLastUsedMethod(): LastUsedMethod | null {
  const [method, setMethod] = useState<LastUsedMethod | null>(null);
  useEffect(() => setMethod(readSignInMethod()), []);
  return method;
}

/** The quiet "Last used" marker. Never a control, never the only signal. */
export function LastUsedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-app-tint px-2 py-0.5 text-[11px] font-medium leading-none text-app-petrol-deep",
        className,
      )}
    >
      Last used
    </span>
  );
}
