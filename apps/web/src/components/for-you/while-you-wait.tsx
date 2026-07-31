"use client";

import {
  registrationProgress,
  isWaitingOnRegistration,
  type RegistrationSnapshot,
} from "@loonext/shared";
import { ArrowRight, Check, Phone } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMeCompany } from "@/lib/api/me-company";

/**
 * #310 — the waiting room, made into somewhere.
 *
 * A tradesperson signs up at 9pm on a Sunday because they are fed up with
 * missing jobs, and we say "come back in a few days" while 10DLC registration
 * clears. Every day of that wait is a day the product delivered nothing while
 * charging — and the reason people leave is not the wait itself. It is that
 * "pending" with no visible movement is indistinguishable from broken.
 *
 * So this card does three things, in this order, and the order is the point:
 *
 *   1. SHOWS THE WAIT WORKING. A stage, an honest range, and what happens
 *      next. Never a spinner.
 *   2. LEADS WITH WHAT ALREADY WORKS. Calling, voicemail and inbound are live
 *      from day one. The old banner mentioned calling as a consolation prize;
 *      a workspace that spends the wait TAKING CALLS has already adopted the
 *      product.
 *   3. SEQUENCES THE SETUP that does not depend on approval. All of it was
 *      possible before; none of it was ever presented as "here is what to do
 *      while you wait".
 *
 * Applying: the **Goal Gradient Effect** — the bar never starts at 0%, because
 * paying, choosing a number and submitting are real progress and a bar at zero
 * for four days IS the spinner this replaces. **Chunking** — three next steps,
 * not the whole settings surface. And the **Zen of Clarity**: this disappears
 * the moment texting is live, rather than becoming permanent furniture.
 */
export function WhileYouWait() {
  const { data } = useMeCompany();
  const snapshot = data?.company?.registration as RegistrationSnapshot | undefined;

  // Only while the wait is genuinely on the carriers. A workspace we are
  // waiting ON gets nothing from here — pointing it at templates would point
  // away from the thing actually blocking it.
  if (!snapshot || !isWaitingOnRegistration(snapshot)) return null;

  const progress = registrationProgress(snapshot);

  return (
    <section
      className="rounded-app-card border border-app-line bg-app-paper p-4 md:p-5"
      aria-labelledby="while-you-wait-heading"
    >
      <h2 id="while-you-wait-heading" className="text-sm font-semibold">
        {progress.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{progress.next}</p>

      {/* The bar. Its value is "steps behind you", not a fabricated estimate of
          time remaining — a countdown we cannot honour is worse than none. */}
      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-app-tint"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Texting registration progress"
      >
        <div
          className="h-full rounded-full bg-app-olive-deep transition-[width] duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {progress.expected && (
        <p className="mt-2 text-xs text-muted-foreground">{progress.expected}</p>
      )}

      {/* What already works. FIRST, not as a footnote — this is the habit worth
          forming during the wait, and it is available today. */}
      <div className="mt-5 flex items-start gap-3 rounded-lg bg-app-tint/60 p-3">
        <Phone className="mt-0.5 size-4 shrink-0 text-app-olive-deep" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Calls already work</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Your number rings, takes voicemail, and texts back anyone you miss.
            None of that waits on the carriers.
          </p>
        </div>
      </div>

      {/* Three, not everything. The brain holds 3–4 items, and a settings tour
          is not a sense of arriving somewhere. */}
      <ul className="mt-4 space-y-1">
        <SetupStep href="/contacts" label="Bring your customers in" />
        <SetupStep href="/settings/team" label="Invite your crew" />
        <SetupStep href="/settings/hours" label="Set your hours and greeting" />
      </ul>
    </section>
  );
}

/**
 * One thing worth doing now.
 *
 * Deliberately NOT a checkbox with a done state. Completion here would need a
 * definition of "enough contacts" or "enough templates" that we do not have,
 * and a checklist that stays unticked while somebody has plainly done the work
 * is its own small insult. These are doors, and the arrow says so.
 */
function SetupStep({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Button
        asChild
        variant="ghost"
        className="h-auto w-full justify-start gap-2 px-2 py-2 text-sm font-normal"
      >
        <Link href={href}>
          <Check className="size-4 shrink-0 text-app-muted-2" aria-hidden />
          <span className="flex-1 text-left">{label}</span>
          <ArrowRight className="size-4 shrink-0 text-app-muted-2" aria-hidden />
        </Link>
      </Button>
    </li>
  );
}
