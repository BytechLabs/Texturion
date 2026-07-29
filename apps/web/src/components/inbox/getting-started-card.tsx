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
import { useMemberFirsts } from "@/lib/api/me-company";
import { useActiveCompany, useCompanyId } from "@/lib/company/provider";
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
 *
 * ---------------------------------------------------------------------------
 * #405: TWO CARDS, BECAUSE TWO AUDIENCES ARRIVE DIFFERENTLY.
 *
 * The list above is an OWNER'S list, and two of its items are things a member
 * cannot do at all — getting a number and inviting a teammate are both
 * owner/admin. A tech invited on Monday used to open the app to a checklist
 * where half the items were impossible for them and one was already done.
 *
 * The arithmetic makes that the common case rather than the edge one: plans
 * allow 3 seats on Starter and 15 on Pro, so most people using this product
 * are members, and the only first-run guidance we shipped was written for the
 * one person who least needs it — they just walked a five-step wizard and
 * chose the tool. The member did not choose it. They were told to use it.
 *
 * So a member gets a DIFFERENT list, not a filtered one, on the same derived
 * principle: it disappears as they actually do the things.
 * *Applying: Smart Personalization — the same surface answers the question the
 * reader actually has.*
 */

const DISMISS_KEY_PREFIX = "loonext:getting-started-dismissed:";
/** #405: its own key — dismissing one card must not hide the other. */
const MEMBER_DISMISS_KEY_PREFIX = "loonext:member-started-dismissed:";

interface StepItem {
  key: string;
  done: boolean;
  label: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}

export function GettingStartedCard() {
  const { role } = useActiveCompany();
  // #405: owner and admin get the setup list; everybody else gets the one
  // about doing the job. Checked before any of the setup queries below matter,
  // so a member never pays for data about a card they will not see.
  const isSetupAudience = role === "owner" || role === "admin";
  if (!isSetupAudience) return <MemberStartedCard />;
  return <OwnerStartedCard />;
}

/**
 * What changes about a crew member's day, derived from what they have done.
 *
 * NOTHING ABOUT SETUP. The workspace already works — they were invited into a
 * running one. What they need is the handful of behaviours that differ from
 * texting off a personal cell, and the one that is genuinely dangerous to get
 * wrong is the note: a note is not a text, and finding that out by accident
 * means a customer received something meant for a colleague.
 * *Applying: Chunking — three things, which is what a person holds.*
 */
function MemberStartedCard() {
  const companyId = useCompanyId();
  const firsts = useMemberFirsts(true);

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setDismissed(
        window.localStorage.getItem(MEMBER_DISMISS_KEY_PREFIX + companyId) === "1",
      );
    } catch {
      setDismissed(false);
    }
  }, [companyId]);

  if (dismissed !== false || !firsts.data) return null;

  const items: StepItem[] = [
    {
      key: "reply",
      done: firsts.data.replied,
      label: "Answer a customer",
      hint: firsts.data.replied
        ? undefined
        : "Open a thread and reply. It goes out from the business number, and the whole crew can see it.",
    },
    {
      key: "note",
      done: firsts.data.noted,
      label: "Leave a note for the crew",
      // The one worth learning deliberately rather than by accident.
      hint: firsts.data.noted
        ? undefined
        : "Switch the composer to Note. Notes stay inside the app — the customer never sees them.",
    },
    {
      key: "done",
      done: firsts.data.marked_done,
      label: "Mark something done",
      hint: firsts.data.marked_done
        ? undefined
        : "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it.",
    },
  ];

  if (items.every((item) => item.done)) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(MEMBER_DISMISS_KEY_PREFIX + companyId, "1");
    } catch {
      // Storage blocked — hide for this visit anyway.
    }
    setDismissed(true);
  }

  return (
    <ChecklistCard
      title="Getting the hang of it"
      items={items}
      onDismiss={dismiss}
      // Their notification settings are their own, which is a real adoption
      // blocker for anybody picturing evening buzzing — and there is nothing
      // to derive from, because opening a settings page is not a row.
      footer={
        <>
          Your notification settings are yours alone.{" "}
          <Link href="/settings/notifications" className="underline">
            Change when we buzz you
          </Link>
          .
        </>
      }
    />
  );
}

function OwnerStartedCard() {
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
      // The work already done, credited. This card only renders AFTER payment,
      // so choosing a plan is a real finished step, not padding: the reader
      // picked a plan and paid before ever seeing this. Starting a setup list
      // at zero for someone who has already done something reads as "none of
      // that counted", and the two steps below it are not even theirs to act
      // on — a number provisions itself, and the first text arrives when a
      // customer decides to send one.
      key: "signup",
      done: true,
      label: "Set your workspace up",
    },
    {
      key: "number",
      done: numberDone,
      label: "Get your business number",
      hint: numberDone
        ? undefined
        : numberStalled
          ? "Taking a little longer than usual. You don't need to do anything."
          : "It's on its way, usually under a minute.",
    },
    {
      key: "inbound",
      done: inboundDone,
      label: "Receive your first text",
      hint: inboundDone
        ? undefined
        : "Text your number from your phone, and it lands right here.",
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

  return (
    <ChecklistCard
      title="Getting started"
      items={items}
      onDismiss={dismiss}
    />
  );
}

/**
 * The shared chrome: a heading, a progress bar, and the ticked list.
 *
 * Extracted when the member variant arrived (#405) rather than duplicated,
 * because two checklists that drift apart visually read as two different
 * features — and the progress bar is the one piece carrying the momentum both
 * lists depend on.
 * *Applying: the Goal Gradient Effect — progress is visible, and neither list
 * starts at zero for somebody who has already done something.*
 */
function ChecklistCard({
  title,
  items,
  onDismiss,
  footer,
}: {
  title: string;
  items: StepItem[];
  onDismiss: () => void;
  footer?: React.ReactNode;
}) {
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {doneCount} of {items.length} done
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Dismiss ${title.toLowerCase()}`}
          onClick={onDismiss}
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      {/* Progress you can see, not only count. The bar is the momentum; the
          numbers above are the detail. */}
      <div
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-app-line-soft"
        role="img"
        aria-label={`${doneCount} of ${items.length} steps done`}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
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
                  // The strike inherits the text colour. `decoration-border`
                  // painted it in the hairline tone, which is nearly invisible
                  // on the card, so a finished step read as faint text with no
                  // line through it rather than as done.
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.label}
                <span className="sr-only">
                  {item.done ? ", done" : ", not done yet"}
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
      {footer ? (
        <p className="mt-3 text-[13px] text-muted-foreground">{footer}</p>
      ) : null}
    </section>
  );
}
