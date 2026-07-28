"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { apiFetch } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useMe } from "@/lib/api/me";
import { useQueryClient } from "@tanstack/react-query";

/**
 * #386 — "we can't reach this address."
 *
 * A hard-bounced address is otherwise completely invisible to the person it
 * belongs to: their notifications simply stop, which is indistinguishable from
 * a quiet week. The whole point of this surface is that the failure becomes
 * FIXABLE rather than merely broken.
 *
 * It renders nothing at all when email is working. A false "we can't reach
 * you" is worse than none — it sends somebody to fix an address that was never
 * broken, and teaches them to disbelieve the next one.
 * *Applying: the Zen of Clarity — a surface that is silent when there is
 * nothing to say.*
 *
 * Deliberately NOT a modal or a global banner. This is account state, not an
 * interruption, and it lives beside the email toggle whose promise it
 * contradicts.
 * *Applying: the Safety Principle — the fix belongs where the setting it
 * explains already is.*
 */
export function EmailReachabilityCard() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const state = me.data?.email_state;
  if (!state) return null;

  async function retry() {
    setRetrying(true);
    try {
      await apiFetch("/v1/me/email/retry", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.success("We'll try that address again on your next notification.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't do that. Try again.",
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    // The warning family rather than destructive red: nothing has been
    // destroyed and nothing is at risk of being. Something is not arriving,
    // and the tone should say "look at this", not "you have broken something".
    // *Applying: Meaningful Highlights — the accent budget is spent on the one
    // thing that needs action.*
    <div className="rounded-app-card border border-app-amber-line bg-app-amber-bg px-5 py-4">
      <p className="text-sm font-semibold text-app-ink">
        We can&apos;t email you at {state.email}
      </p>

      {state.fixable ? (
        <>
          <p className="mt-1 text-sm text-app-muted">
            Emails to this address are bouncing, so we&apos;ve stopped sending
            them. Push notifications still work. If the address was mistyped,
            fix it in your account first, then tell us to try again.
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
              {retrying ? "Trying…" : "Try this address again"}
            </Button>
          </div>
        </>
      ) : (
        // No button, on purpose. The address reported us as spam, and one tap
        // in our own app is not that person's consent to start again.
        // *Applying: Ethical Friction, inverted — the friction here is the
        // absence of a shortcut we are not entitled to offer.*
        <p className="mt-1 text-sm text-app-muted">
          This address reported our email as spam, so we&apos;ve stopped sending
          to it for good. Push notifications still work. To get email again,
          change your account to a different address.
        </p>
      )}
    </div>
  );
}
