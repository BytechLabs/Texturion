"use client";

/**
 * D43 (#135) — a tiny "can this browser receive calls right now?" indicator.
 * Green = registered and WILL ring; amber = connecting or recovering; red = it
 * tried and failed. The whole inbound-ring incident was invisible because there
 * was no way to see this — now there is.
 *
 * The failed state is not cosmetic. Registration can be refused outright (the
 * token mint rejected because browser calling is unconfigured or the
 * subscription lapsed), and reporting that as "Connecting…" left a member
 * watching a hopeful pulsing dot while every incoming call went unanswered.
 * A retry still runs on the next foreground or reconnect, which is why this
 * says the phone is not connected rather than that calling is broken forever.
 */
import { useT } from "@/i18n/provider";
import { useSoftphone } from "@/lib/softphone/provider";
import { cn } from "@/lib/utils";

export function SoftphoneStatus({ className }: { className?: string }) {
  const t = useT();
  const softphone = useSoftphone();
  const ready = softphone?.ready ?? false;
  // `error` is cleared the moment registration succeeds, so this can only be
  // set while the phone is genuinely down.
  const failed = !ready && Boolean(softphone?.error);

  return (
    <span
      // Announce the ready↔connecting transition to screen readers — a purely
      // visual dot + title text left it silent for non-sighted users who most
      // need to know their browser can (or can't yet) ring for a call.
      role="status"
      aria-live="polite"
      className={cn(
        // Never wrap: this sits inline in a crowded header, and a two-line
        // status pushes the row's other controls around.
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium",
        className,
      )}
      title={
        ready
          ? t("shell.phoneReadyTitle")
          : failed
            ? t("shell.phoneFailedTitle")
            : t("shell.phoneConnectingTitle")
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          ready && "bg-emerald-500",
          // A failed phone holds a steady dot: the pulse is what reads as
          // progress, and there is none to report.
          failed && "bg-destructive",
          !ready && !failed && "animate-pulse bg-amber-500",
        )}
        aria-hidden
      />
      <span
        className={cn(
          ready && "text-app-muted",
          failed && "text-destructive",
          !ready && !failed && "text-amber-600 dark:text-amber-500",
        )}
      >
        {ready
          ? t("shell.phoneReady")
          : failed
            ? t("shell.phoneCantRing")
            : t("shell.phoneConnecting")}
      </span>
    </span>
  );
}
