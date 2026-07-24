"use client";

/**
 * D43 (#135) — a tiny "can this browser receive calls right now?" indicator.
 * Green = the softphone is registered and WILL ring for incoming calls; amber =
 * connecting/recovering (it can't ring yet). The whole inbound-ring incident was
 * invisible because there was no way to see this — now there is.
 */
import { useSoftphone } from "@/lib/softphone/provider";
import { cn } from "@/lib/utils";

export function SoftphoneStatus({ className }: { className?: string }) {
  const softphone = useSoftphone();
  const ready = softphone?.ready ?? false;

  return (
    <span
      // Announce the ready↔connecting transition to screen readers — a purely
      // visual dot + title text left it silent for non-sighted users who most
      // need to know their browser can (or can't yet) ring for a call.
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium",
        className,
      )}
      title={
        ready
          ? "Your browser will ring for incoming calls"
          : "Connecting your phone — incoming calls won't ring until this is ready"
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          ready ? "bg-emerald-500" : "animate-pulse bg-amber-500",
        )}
        aria-hidden
      />
      <span
        className={
          ready ? "text-app-muted" : "text-amber-600 dark:text-amber-500"
        }
      >
        {ready ? "Ready" : "Connecting…"}
      </span>
    </span>
  );
}
