"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useMyInvites } from "@/lib/api/team";
import type { MyInvite } from "@/lib/api/types";

/** sessionStorage key for a dismissed invite (per invite, per browser session). */
const dismissKey = (inviteId: string) => `jt-invite-dismissed:${inviteId}`;

/**
 * #109: the self-serve invite discovery banner. An EXISTING account that gets
 * invited can't be reached through the Supabase signup email, so beyond the
 * direct email (also #109) the app itself surfaces the pending invite: a calm
 * floating card — "you've been invited to {company} — Join" — linking to the
 * same /invite/:id accept page the email carries.
 *
 * Shows the newest pending invite; accepting or dismissing reveals the next
 * (dismissal is per-invite, per-session — a new session re-surfaces it while
 * it's still pending). Renders nothing while loading, on error, or when every
 * pending invite is dismissed — the banner is ambient, never blocking.
 */
export function InviteBanner() {
  const invites = useMyInvites();
  // Dismissals live in sessionStorage; mirror into state so dismissing hides
  // the card without a refetch.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Hydrate dismissals once the pending set arrives (sessionStorage is
  // unavailable during SSR, so this runs client-side only).
  useEffect(() => {
    if (!invites.data) return;
    const seen = new Set<string>();
    try {
      for (const invite of invites.data.data) {
        if (sessionStorage.getItem(dismissKey(invite.id)) === "1") {
          seen.add(invite.id);
        }
      }
    } catch {
      // Private mode / storage disabled: in-memory dismissals still work.
    }
    setDismissed((current) => {
      const next = new Set(current);
      for (const id of seen) next.add(id);
      return next;
    });
  }, [invites.data]);

  const pending: MyInvite[] = invites.data?.data ?? [];
  const invite = pending.find((i) => !dismissed.has(i.id));
  if (!invite) return null;

  const company = invite.company_name?.trim() || "a Loonext workspace";

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissKey(invite.id), "1");
    } catch {
      // Storage unavailable — the in-memory set below still hides it.
    }
    setDismissed((current) => new Set(current).add(invite.id));
  };

  return (
    <div
      role="status"
      aria-label={`You've been invited to join ${company}`}
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-app-card border border-app-line bg-app-white px-4 py-3 shadow-lg"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <p className="min-w-0 text-sm text-app-ink">
        You&apos;ve been invited to join{" "}
        <span className="font-semibold">{company}</span>
      </p>
      <Button asChild size="sm" className="shrink-0">
        <Link href={`/invite/${invite.id}`}>Join</Link>
      </Button>
      <button
        type="button"
        aria-label="Dismiss invite"
        onClick={dismiss}
        className="tap-target shrink-0 rounded-full p-1 text-app-muted-2 transition-colors hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
