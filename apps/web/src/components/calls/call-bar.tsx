"use client";

/**
 * D43 (#135) call bar — the persistent in-app call surface. Renders only while
 * a call is live (or just ended); mounted once from the app shell. The browser
 * IS the phone: the customer's audio plays through the softphone provider's
 * hidden <audio>, and this bar is the controls (mute, hang up) + live timer.
 *
 * Fixed above the mobile tab bar; a slim floating card on desktop. Absent
 * entirely at idle so it never occupies space.
 */
import { Mic, MicOff, PhoneOff, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatCallDuration } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { useSoftphone } from "@/lib/softphone/provider";
import { cn } from "@/lib/utils";

function LiveTimer({ since }: { since: number }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - since) / 1000)),
  );
  useEffect(() => {
    const id = window.setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [since]);
  return <span className="tabular-nums">{formatCallDuration(elapsed)}</span>;
}

export function CallBar() {
  const softphone = useSoftphone();
  if (!softphone || softphone.phase === "idle") return null;

  const { phase, peer, muted, activeSince, hangup, toggleMute, clear } =
    softphone;
  const name = peer?.name ?? "Calling";
  const number = peer?.number ? formatPhone(peer.number) : "";

  const status =
    phase === "connecting"
      ? "Calling…"
      : phase === "active" && activeSince !== null
        ? undefined // the timer renders instead
        : "Call ended";

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 flex justify-center px-3",
        // Sit above the mobile tab bar; float near the bottom on desktop.
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-4",
      )}
      role="region"
      aria-label="Active call"
    >
      <div
        className={cn(
          "flex w-full max-w-md items-center gap-3 rounded-app-card border px-4 py-2.5 shadow-lg",
          phase === "ended"
            ? "border-app-line bg-app-white text-app-muted-2"
            : "border-primary/20 bg-app-white text-app-ink",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            phase === "active"
              ? "bg-primary animate-pulse"
              : phase === "connecting"
                ? "bg-warning animate-pulse"
                : "bg-app-muted-2",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-app-muted-2">
            {status ??
              (activeSince !== null ? <LiveTimer since={activeSince} /> : "")}
            {number && phase !== "ended" ? ` · ${number}` : ""}
          </p>
        </div>

        {phase === "ended" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={clear}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? (
                <MicOff className="size-4 text-app-clay" strokeWidth={1.75} />
              ) : (
                <Mic className="size-4" strokeWidth={1.75} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hang up"
              onClick={hangup}
              className="text-app-clay hover:bg-app-clay/10"
            >
              <PhoneOff className="size-4" strokeWidth={1.75} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
