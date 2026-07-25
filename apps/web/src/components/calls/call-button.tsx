"use client";

/**
 * D43 (#135) click-to-call — the browser IS the phone. The thread's Call
 * button places the call in-app through the softphone (mic + WebRTC); the
 * customer sees the business number, and the CallBar carries the live call.
 * The D38 cell bridge (dial-me-first) and its D40 SMS verification are
 * DELETED — no cell number exists anywhere in the flow.
 *
 * The server still owns every gate (subscription, #106 access, voice cap,
 * line busy) via POST /v1/calls/browser; its refusal message lands in the
 * toast unchanged.
 */
import { Phone, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { MicPermissionError, useSoftphone } from "@/lib/softphone/provider";

export function CallButton({
  conversationId,
  contactId,
  contactName,
  label,
  className,
}: {
  /** Call from an existing thread… */
  conversationId?: string;
  /** …or a contact with no thread yet (fresh import). Exactly one is set. */
  contactId?: string;
  contactName: string;
  /**
   * Render as a labelled button instead of the header's icon. Used where the
   * call is being OFFERED rather than sat in a toolbar, so the reader is told
   * it exists. Same softphone path either way: one button owns the busy state,
   * the mic-permission copy and the server's refusal message.
   */
  label?: string;
  className?: string;
}) {
  const softphone = useSoftphone();
  // Phase 3 (call waiting): a member can hold one call and start another —
  // the button rests only at the 2-call ceiling or while one is connecting.
  const liveCount =
    softphone?.calls.filter((c) => c.phase !== "ended").length ?? 0;
  const busy =
    liveCount >= 2 || softphone?.calls.some((c) => c.phase === "connecting");

  function onClick() {
    if (!softphone) {
      toast.error("Calling isn't available right now. Try reloading the app.");
      return;
    }
    void softphone
      .placeCall({ conversationId, contactId, contactName })
      .catch((cause) =>
        toast.error(
          // MicPermissionError carries the only actionable copy in this path
          // ("Microphone access is blocked. Click the 🎤 or 🔒 icon…"), and the
          // concurrency ceiling now throws a written message too. Narrowing on
          // ApiError alone showed "Try again." for both — advice that cannot
          // work for a blocked mic. Anything else still gets the calm generic,
          // so a raw fetch/chunk-load failure never reaches the user.
          cause instanceof MicPermissionError || cause instanceof ApiError
            ? cause.message
            : "Couldn't start the call. Try again.",
        ),
      );
  }

  const icon = busy ? (
    <PhoneOutgoing className="size-4 animate-pulse" strokeWidth={1.75} />
  ) : (
    <Phone className="size-4" strokeWidth={1.75} />
  );

  return (
    <Button
      variant={label ? "default" : "ghost"}
      size={label ? "sm" : "icon-sm"}
      className={className}
      aria-label={
        busy ? "On a call…" : `Call ${contactName} from your business number`
      }
      onClick={onClick}
      disabled={busy}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </Button>
  );
}
