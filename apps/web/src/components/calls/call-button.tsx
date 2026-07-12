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
import { useSoftphone } from "@/lib/softphone/provider";

export function CallButton({
  conversationId,
  contactName,
  className,
}: {
  conversationId: string;
  contactName: string;
  className?: string;
}) {
  const softphone = useSoftphone();
  // One live call per member: the button rests while any call is up.
  const busy =
    softphone?.phase === "connecting" ||
    softphone?.phase === "active" ||
    softphone?.phase === "ringing";

  function onClick() {
    if (!softphone) {
      toast.error("Calling isn't available right now. Try reloading the app.");
      return;
    }
    void softphone
      .placeCall({ conversationId, contactName })
      .catch((cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't start the call. Try again.",
        ),
      );
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={
        busy ? "On a call…" : `Call ${contactName} from your business number`
      }
      onClick={onClick}
      disabled={busy}
    >
      {busy ? (
        <PhoneOutgoing className="size-4 animate-pulse" strokeWidth={1.75} />
      ) : (
        <Phone className="size-4" strokeWidth={1.75} />
      )}
    </Button>
  );
}
