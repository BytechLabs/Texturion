"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/error";
import { useRevokeJobPhotos, useShareJobPhotos } from "@/lib/api/tasks";
import { formatAbsoluteDateTime } from "@/lib/format/time";

/**
 * #294 — hand the customer a page with the photos on it.
 *
 * ## Evaluation
 *
 * The issue names a constraint nobody had written down: the best job documentation
 * is structurally internal-only. A full-resolution photo of a serial plate has to
 * travel as a note, because a text is capped at 1 MB per image and three per
 * message. So "here is everything we did" over MMS means picking three of them and
 * hoping the compression left something readable. A link does not have that problem.
 *
 * ## What binds it
 *
 * *Prioritize Intent* — it renders nothing at all until the job HAS photos. An
 * offer to share an empty set is an offer to look unprofessional.
 *
 * *Ethical Friction, in proportion* — one press, no dialog. This puts a record of
 * the inside of somebody's home on the public internet, so it is audited and it
 * expires; but the crew member doing it is standing in front of the customer saying
 * "I'll send you the pictures", and a confirmation dialog there is friction on the
 * good path. The undo is the part that matters, and it is one press too.
 *
 * *Zen of Clarity* — the link appears as text with one Copy button. No QR code, no
 * share sheet, no email composer: the crew is about to paste it into the thread they
 * already have open with this customer, which is the whole point of the product.
 *
 * *Loss Aversion, honestly* — the expiry is stated on screen rather than buried,
 * because a customer opening a dead link months later reflects on the business, not
 * on us.
 */
export function ShareJobPhotos({
  taskId,
  photoCount,
}: {
  taskId: string;
  photoCount: number;
}) {
  const share = useShareJobPhotos(taskId);
  const revoke = useRevokeJobPhotos(taskId);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Nothing to share, nothing to offer.
  if (photoCount === 0) return null;

  const create = () => {
    share.mutate(undefined, {
      onSuccess: (result) => {
        setLink({ url: result.url, expiresAt: result.expires_at });
        setCopied(false);
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Couldn't make that link. Try again.",
        ),
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied. Paste it into the thread.");
    } catch {
      // A blocked clipboard is not an error worth a red toast: the link is on
      // screen and selectable, which is the fallback every browser still has.
      toast.message("Select the link and copy it.");
    }
  };

  const withdraw = () => {
    revoke.mutate(undefined, {
      onSuccess: () => {
        setLink(null);
        toast.success("That link no longer opens.");
      },
      onError: () => toast.error("Couldn't turn that link off. Try again."),
    });
  };

  if (link === null) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={create}
        disabled={share.isPending}
        className="gap-1.5"
      >
        <Link2 className="size-3.5" aria-hidden />
        {share.isPending ? "Making a link…" : "Share these photos"}
      </Button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-app-hover/40 p-2.5">
      <p className="text-[12.5px] text-app-muted">
        Anyone with this link can see the photos until{" "}
        {formatAbsoluteDateTime(link.expiresAt)}.
      </p>
      <div className="flex items-center gap-1.5">
        {/* Selectable text rather than an input: it is not editable, and an
            input invites somebody to try. */}
        <code className="min-w-0 flex-1 truncate rounded bg-app-paper px-2 py-1 text-[12px]">
          {link.url}
        </code>
        <Button variant="outline" size="sm" onClick={() => void copy()} className="gap-1.5">
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={withdraw}
        disabled={revoke.isPending}
        className="h-auto px-1 py-0.5 text-[12px] text-app-muted"
      >
        {revoke.isPending ? "Turning it off…" : "Turn this link off"}
      </Button>
    </div>
  );
}
