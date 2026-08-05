import { numberForPort } from "@/components/porting/port-ui-state";
import type { HeldNumbersView } from "@/lib/api/billing";
import type {
  CompanyView,
  PhoneNumberSummary,
  PortRequest,
} from "@/lib/api/types";

/**
 * #523 — WHY this number is suspended, and therefore what to tell its owner.
 *
 * # The defect this closes
 *
 * A suspended number on the numbers screen used to say one thing, always:
 *
 *     Texting is paused. Update your payment method to turn it back on.
 *
 * That sentence was written when a lapsed card was the only way a number could
 * be suspended. #523 adds a second way, and against it the sentence is simply
 * false: the workspace resubscribed onto a smaller plan, the payment went
 * through, and the card is fine. It sends somebody to a Stripe portal to fix
 * something that is not broken, and leaves the real reason — the plan covers
 * fewer numbers than they hold — unsaid on the one screen that shows the
 * number. Being told to fix a working card is worse than being told nothing.
 *
 * # Why this is a resolver and not an inline ternary
 *
 * There are three answers, and the third is the one that makes this worth
 * writing down. The server distinguishes the two real reasons and serves them
 * as `reason`, deliberately, so that four clients cannot each infer it from
 * `plan` and `subscription_status` and describe the same state three ways. But
 * `GET /v1/billing/held-numbers` is behind `billing.manage`, so a MEMBER can
 * never read it — and a member looking at a suspended number is exactly the
 * reader most likely to conclude the app is broken.
 *
 * So the third answer is "we genuinely do not know", and it gets copy that
 * asserts no cause rather than guessing at one. What this resolver will not do
 * is reconstruct the server's `reason` out of the two fields it happens to have
 * — that is the drift the server's field exists to prevent, and a client that
 * quietly re-derives it has forked the rule.
 */
export type NumberHoldState =
  /** Server-confirmed: the plan covers fewer numbers than the workspace holds. */
  | { kind: "over_allowance"; allowance: number | null }
  /** The subscription is not live — a lapsed card, or the grace window. */
  | { kind: "subscription_inactive" }
  /** Suspended, and we were not in a position to ask why. */
  | { kind: "unknown" };

export function numberHoldState(args: {
  /** This row's status, straight off the numbers list. */
  status: string;
  numberId: string;
  /** From the company view — a plain fact every role can read. */
  subscriptionActive: boolean;
  /** The billing answer, when the reader could ask for it. */
  held: HeldNumbersView | undefined;
}): NumberHoldState | null {
  if (args.status !== "suspended") return null;

  // The server's own answer, and it wins whenever we have it. Membership of
  // `held` is checked rather than `reason` alone: `reason` describes the
  // workspace, and a workspace can hold one number over its allowance while
  // another sits suspended for some unrelated reason a later issue introduces.
  if (
    args.held?.reason === "over_plan_allowance" &&
    args.held.held.some((row) => row.id === args.numberId)
  ) {
    return { kind: "over_allowance", allowance: args.held.allowance };
  }

  // No server answer. A dead subscription is a fact this client legitimately
  // has — it is on the company view for every role — and it is not the server's
  // `reason` being re-derived, it is the plain state of the account.
  if (!args.subscriptionActive) return { kind: "subscription_inactive" };

  return { kind: "unknown" };
}

/**
 * The same question, asked from the PORT stepper.
 *
 * A transferred-in number is de-duplicated out of the `NumberCard` list (see
 * `port-ui-state.ts`), so its stepper is the only card it has — and the stepper
 * reads the port row, which knows the transfer finished and nothing about
 * whether the line still works. That is how a held ported number came to read
 * "Live on Loonext" with four green ticks over a number that cannot send.
 *
 * Composed out of the two existing pieces rather than given a rule of its own:
 * the port card must answer this question exactly as the number card does, or a
 * workspace holding one bought and one transferred line is told two different
 * stories about one plan.
 */
export function holdForPort(
  port: PortRequest,
  numbers: readonly PhoneNumberSummary[],
  company: Pick<CompanyView, "subscription_status">,
  held: HeldNumbersView | undefined,
): NumberHoldState | null {
  const row = numberForPort(port, numbers);
  if (!row) return null;
  return numberHoldState({
    status: row.status,
    numberId: row.id,
    subscriptionActive: company.subscription_status === "active",
    held,
  });
}
