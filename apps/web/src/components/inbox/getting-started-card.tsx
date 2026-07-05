"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { hasPaid } from "@/app/onboarding/steps";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/api/companies";
import { useConversations } from "@/lib/api/conversations";
import { useMembers } from "@/lib/api/team";
import { useUsage } from "@/lib/api/usage";
import { useCompanyId } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/**
 * Getting-started progress card (cross-track contract; DESIGN.md G7 step 7):
 * a quiet checklist — not a tour — mounted dismissibly atop the inbox list
 * (inbox-pane.tsx), above the activation empty state when the list is empty.
 * Every item derives from real data:
 *
 * - number       → an active phone number on GET /v1/company
 * - first inbound→ any conversation exists (GET /v1/conversations page 1)
 * - first reply  → outbound segments metered on GET /v1/usage
 * - teammate     → more than one active member on GET /v1/members
 *
 * Renders null while loading/on error (ambient card, never blocks the
 * inbox), when dismissed (localStorage, per company), or once complete.
 */

const DISMISS_KEY_PREFIX = "loonext:getting-started-dismissed:";

interface StepItem {
  key: string;
  done: boolean;
  label: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}

export function GettingStartedCard() {
  const companyId = useCompanyId();
  const company = useCompany();
  const conversations = useConversations({});
  const usage = useUsage();
  const members = useMembers();

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setDismissed(
        window.localStorage.getItem(DISMISS_KEY_PREFIX + companyId) === "1",
      );
    } catch {
      setDismissed(false);
    }
  }, [companyId]);

  if (
    dismissed !== false ||
    !company.data ||
    !conversations.data ||
    !usage.data ||
    !members.data
  ) {
    return null;
  }

  // G7 step 7 is the POST-payment first inbox visit. Pre-checkout (or after
  // cancellation) "Get your business number — it's on its way" would be a
  // lie (G1.5): the wizard/billing surfaces own setup until the company pays,
  // and the activation empty state carries the way back there.
  if (!hasPaid(company.data.subscription_status)) return null;

  const numberDone = company.data.numbers.some((n) => n.status === "active");
  // Don't promise "under a minute" once a purchase has actually stalled — the
  // honest delayed line matches the app-wide status banner for the same state.
  const numberStalled =
    !numberDone &&
    company.data.numbers.some((n) => n.status === "provision_failed");
  const inboundDone = conversations.data.pages.some(
    (page) => page.data.length > 0,
  );
  const replyDone = usage.data.used_segments > 0;
  const teammateDone =
    members.data.data.filter((m) => m.deactivated_at === null).length > 1;

  const items: StepItem[] = [
    {
      key: "number",
      done: numberDone,
      label: "Get your business number",
      hint: numberDone
        ? undefined
        : numberStalled
          ? "Taking a little longer than usual — you don't need to do anything."
          : "It's on its way — usually under a minute.",
    },
    {
      key: "inbound",
      done: inboundDone,
      label: "Receive your first text",
      hint: inboundDone
        ? undefined
        : "Text your number from your phone — it lands right here.",
    },
    {
      key: "reply",
      done: replyDone,
      label: "Send your first reply",
      hint: replyDone
        ? undefined
        : "Open a conversation and answer like you would from your cell.",
    },
    {
      key: "teammate",
      done: teammateDone,
      label: "Invite a teammate",
      href: teammateDone ? undefined : "/settings/team",
      linkLabel: "Invite",
    },
  ];

  if (items.every((item) => item.done)) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY_PREFIX + companyId, "1");
    } catch {
      // Storage blocked — hide for this visit anyway.
    }
    setDismissed(true);
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <section
      aria-label="Getting started"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Getting started</h2>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {doneCount} of {items.length} done
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss getting started"
          onClick={dismiss}
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      <ul className="mt-3 space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-0.5 flex size-4 items-center justify-center rounded-full border",
                item.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border",
              )}
              aria-hidden
            >
              {item.done ? <Check className="size-3" strokeWidth={2.5} /> : null}
            </span>
            <div className="min-w-0 flex-1 text-sm leading-snug">
              <span
                className={cn(
                  item.done && "text-muted-foreground line-through decoration-border",
                )}
              >
                {item.label}
                <span className="sr-only">
                  {item.done ? " — done" : " — not done yet"}
                </span>
              </span>
              {!item.done && item.hint ? (
                <p className="text-[13px] text-muted-foreground">{item.hint}</p>
              ) : null}
            </div>
            {!item.done && item.href ? (
              <Link
                href={item.href}
                className="shrink-0 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
              >
                {item.linkLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
