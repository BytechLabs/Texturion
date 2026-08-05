"use client";

import { CANCELLATION_GRACE_DAYS, cancellationOffer } from "@loonext/shared";
import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";

import { CancellationAnswer } from "@/components/settings/cancellation-answer";
import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  useBillingPortal,
  useRecordCancellationReason,
} from "@/lib/api/billing";
import { useExportContacts } from "@/lib/api/contacts-export-hook";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";

/**
 * The six answers, and the codes stored for them.
 *
 * The label is only what this screen shows; the CODE is what is recorded, and
 * it is the same string on every client so one report counts one thing. Each
 * stays inside the 40 characters the route accepts.
 */
export const CANCELLATION_REASONS = [
  { code: "too_expensive", label: "Too expensive" },
  { code: "seasonal", label: "Quiet season, I'll be back" },
  { code: "missing_feature", label: "Missing something I need" },
  { code: "switched", label: "Going with something else" },
  { code: "not_using", label: "Not using it" },
  { code: "other", label: "Something else" },
] as const;

export type CancellationReasonCode =
  (typeof CANCELLATION_REASONS)[number]["code"];

/**
 * The route's cap on the free-text note. Trimmed as it is typed, so a long
 * note becomes a short one rather than a 422 discovered at the last click.
 */
const DETAIL_MAX = 2000;

/** Shown once the end is in sight, not from the first character. */
const DETAIL_COUNTDOWN_FROM = 200;

/**
 * The words this surface owns, exported so the tests read the shipped copy
 * rather than a paraphrase of it.
 *
 * THE HOLD IS ANCHORED TO THE CANCELLATION, NOT TO THE PERIOD END, and that is
 * the most expensive sentence on this card to get wrong. `runGraceJob` measures
 * `now - companies.canceled_at` and releases at 30;
 * `startCancellationLifecycle` stamps that column from Stripe's own
 * `subscription.canceled_at`, which for a `cancel_at_period_end` cancellation
 * is the time of the REQUEST — the vendored `Subscriptions.d.ts` says so in as
 * many words ("the time of the most recent update request, not the end of the
 * subscription period").
 *
 * So "texting stops at the end of your billing period, and we hold your number
 * for 30 days" has only one reading, and it is the wrong one: somebody who
 * cancels on day 2 of a monthly period counts about 59 days and has about 30.
 * What they lose at the end of the miscount is the number on the side of the
 * van and on their invoices. Wrong in the customer's favour about a deadline is
 * the expensive direction to be wrong in, so the anchor is named out loud, in
 * the same words the scheduled-cancellation notice at the top of this screen
 * uses and the seasonal answer a few lines below it now uses.
 */
export const CANCEL_CONSEQUENCE =
  "Cancel anytime. Texting stops at the end of your billing period, and we " +
  `hold your number for ${CANCELLATION_GRACE_DAYS} days from the day you ` +
  "cancel — not from that date, so the hold can run out soon after texting " +
  "stops. After that the number is released for good.";
export const CANCEL_QUESTION = "If you want to say why, it helps us fix it.";
export const CANCEL_QUESTION_NOTE =
  "Optional, and it changes nothing about cancelling.";
export const CANCEL_EXPORT_TITLE = "Take your contacts with you";
/**
 * The first sentence names the columns the CSV actually carries, and all three
 * clients say it identically, because this is a promise made to somebody who is
 * leaving and cannot come back to check it.
 *
 * `GET /v1/contacts/export` selects name, phone, consent source, consent date
 * and created date, plus each contact's conversation tags. Custom fields are
 * NOT in it. Copy that says "every field you added" is inviting somebody to
 * discover the gap after they have gone, which is the worst moment to find it
 * and the one place we have no way to make it right.
 */
export const CANCEL_EXPORT_NOTE =
  "Every contact in this workspace as a CSV: names, numbers, tags and when " +
  "they opted in. It opens in a spreadsheet and imports into whatever you use " +
  "next. Yours either way.";
export const CANCEL_EXPORT_ACTION = "Export contacts";
export const CANCEL_SKIP_NOTE =
  "Nothing above has to be filled in. This takes you to Stripe either way, " +
  "where you finish cancelling.";
export const CANCEL_ACTION = "Continue to cancel";
/**
 * The non-owner's version of the consequence copy.
 *
 * It says the same three facts as CANCEL_CONSEQUENCE (when texting stops, the
 * 30 day hold and where it is counted from, the release) but never in the
 * second person, because an admin cannot do any of it. "Cancel anytime"
 * followed by "only the owner can cancel" promises something and withdraws it
 * in the next sentence, which reads as either a broken screen or a runaround.
 *
 * The anchor matters MORE here, not less: this is the copy an admin relays to
 * the owner, so an admin who reads the deadline wrong passes the wrong deadline
 * on. See CANCEL_CONSEQUENCE for where the 30 days are actually counted from.
 */
export const CANCEL_ADMIN_CONSEQUENCE =
  "Only the owner can cancel this plan. When they do, texting stops at the " +
  `end of the billing period, and we hold the number for ` +
  `${CANCELLATION_GRACE_DAYS} days from the day they cancel — not from that ` +
  "date, so the hold can run out soon after texting stops. After that the " +
  "number is released for good.";
export const CANCEL_ADMIN_NOTE =
  "The payment portal an admin reaches is the card screen and has no " +
  "cancellation on it, so this is not something to go looking for there.";

/**
 * #277: asking why, on the way out, without standing in the way.
 *
 * # What this screen is, and what it is deliberately not
 *
 * ONE SCREEN, NOT A FUNNEL. The question, the export offer and the button that
 * leaves all live in this one card, on the billing page, beside the plan card
 * that already offers the cheaper plan. There is no second dialog, no "are you
 * sure", and no step that exists only to be survived. Regulators in several of
 * the markets we sell into enforce against exactly that, and the rule they
 * enforce is the one applied here: cancelling may never take more steps or more
 * time than subscribing did.
 *
 * NOTHING IS COLLAPSED, AND THIS IS THE POINT. The card renders open: no
 * trigger, no sheet, no expand. A control that reveals the screen holding the
 * cancel button is a step, and it makes leaving cost two actions where the
 * neighbouring "Manage payment & invoices" button costs one. Deliberate
 * friction belongs on deleting an account, which cannot be undone; a
 * subscription can be restarted in a minute, and the friction there is a
 * regulatory problem rather than a kindness. Do not copy the collapse from
 * DeleteAccountCard into this file: they are opposite cases.
 *
 * THE WAY THROUGH IS ALWAYS ONE CLICK. From landing on the billing screen,
 * somebody who answers nothing reaches Stripe with a single press.
 * `Continue to cancel` is never disabled by an unanswered question, never
 * waits for the answer to be recorded, and is the loudest control on the card.
 * There is deliberately no "Never mind" beside it: with nothing expanded there
 * is nothing to back out of, and a second button there invites the styling
 * asymmetry (a loud stay, a quiet leave) this card exists to avoid.
 *
 * THE QUESTION IS SUBORDINATE. It sits under the consequence copy in the same
 * muted voice as the rest of the supporting text, because a billing screen
 * should not shout "why are you leaving?" at somebody who came to check their
 * plan. Quiet question, plain exit: the leave button stays the most prominent
 * control in the card.
 *
 * NOTHING IS PRE-SELECTED. A default answer is a reason we made up and then
 * counted, and it fails twice: the person is misrepresented and the report is
 * wrong. (This is the one place the house rule "never ship an empty form, use
 * smart defaults" is deliberately not followed. A pre-filled reason is not a
 * convenience, it is a fabrication.)
 *
 * THE NOTE NEVER BLOCKS THE HANDOFF. The portal call goes first and the reason
 * rides alongside it, unawaited. A dead analytics endpoint must not be able to
 * keep somebody subscribed, so there is no path from a failed POST to a failed
 * cancellation, and a failure is never shown, because it is our record rather
 * than theirs.
 *
 * THE DATA LEAVES WITH THEM. The export offer is here because somebody leaving
 * still needs their contacts, and "they made it hard to leave with our data" is
 * the story told about us afterwards. It exports everything, not a filtered
 * view: this is the copy they keep.
 *
 * OWNER ONLY, HONESTLY. #421 split the portal by role, and an admin lands on
 * Stripe's card-update flow, which has no cancellation surface at all. Offering
 * an admin a cancel button here would send them to a page that cannot do it, so
 * they are told who can instead.
 *
 * THE ANSWER SITS BELOW THE BUTTON THAT LEAVES, and that is arithmetic rather
 * than taste. Picking a reason can produce a true and useful thing to say back
 * (see `cancellation-offers.ts`), but the answer is four or five lines plus a
 * control — around 160px. Measured on a 375px phone, the consequence copy, the
 * six reasons, the note box and the export offer already put `Continue to
 * cancel` roughly two screens below the top of this page; putting the answer
 * between the reasons and the button would add a third of a screen of scrolling
 * to leaving, in direct response to the person having answered an OPTIONAL
 * question. Answering must never cost more than skipping. So the offer renders
 * last, the exit does not move, and nothing about it is conditional on the
 * offer being there.
 */
export function CancelSubscriptionCard({
  isOwner,
  company,
}: {
  isOwner: boolean;
  company: CompanyView;
}) {
  const portal = useBillingPortal();
  const record = useRecordCancellationReason();
  const exportContacts = useExportContacts();
  const [reason, setReason] = useState<CancellationReasonCode | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  /**
   * What we can honestly say about the reason they just picked, or null.
   *
   * Computed from the LOCAL selection rather than read back from the server:
   * the answer belongs to the click, and a round trip would put a spinner in
   * the middle of a cancel screen. Null for four of the six reasons — see the
   * shared module for why each one has nothing worth saying.
   */
  const offer = cancellationOffer({
    reason,
    plan: company.plan,
    billingCurrency: company.billing_currency,
    country: company.country,
    registrationFeePaidAt: company.registration_fee_paid_at,
  });

  function leave() {
    setError(null);
    // The handoff FIRST, so nothing on its way to us can sit between somebody
    // and the way out.
    portal.mutate(undefined, {
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't open the billing portal. Try again.",
        ),
    });
    // Then the note, in the same tick and never awaited. It races a portal
    // round trip that has itself to reach Stripe and back, so in practice it
    // lands first, and when it does not, what is lost is ours rather than
    // theirs.
    // Nothing follows this line and nothing reads its result: a rejection
    // stays inside the mutation, and even a throw could not reach a handoff
    // that has already been issued above.
    record.mutate({
      reason,
      detail: detail.trim().slice(0, DETAIL_MAX) || null,
    });
  }

  function runExport() {
    setExportError(null);
    // "" is every contact. Somebody leaving wants the whole list, not the
    // slice a search box happened to be showing.
    exportContacts.mutate("", {
      onError: (cause) =>
        setExportError(
          cause instanceof ApiError
            ? cause.message
            : "The export didn't go through. Try again.",
        ),
    });
  }

  if (!isOwner) {
    return (
      <SettingsCard title="Cancel">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {CANCEL_ADMIN_CONSEQUENCE}
          </p>
          <p className="text-sm text-muted-foreground">{CANCEL_ADMIN_NOTE}</p>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Cancel">
      {/* Four groups, told apart by spacing rather than by a box or a rule:
          the card edge is already the container, and a panel inside a panel
          reads as a thing that opened. */}
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{CANCEL_CONSEQUENCE}</p>

        <div className="space-y-3">
          {/* One muted line, the same voice as the sentence above it. The ask
              and the reassurance are read together, so they are one paragraph
              rather than a heading with a caption under it. */}
          <p className="text-sm text-muted-foreground">
            {CANCEL_QUESTION} {CANCEL_QUESTION_NOTE}
          </p>

          <RadioGroup
            // Controlled, with no initial value: nothing is selected until
            // somebody selects it.
            value={reason ?? ""}
            onValueChange={(next) => setReason(next as CancellationReasonCode)}
            className="gap-2.5"
            aria-label="Why you are cancelling"
          >
            {CANCELLATION_REASONS.map(({ code, label }) => (
              <div key={code} className="flex items-center gap-2">
                <RadioGroupItem value={code} id={`cancel-reason-${code}`} />
                <Label
                  htmlFor={`cancel-reason-${code}`}
                  className="cursor-pointer text-sm font-normal"
                >
                  {label}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {reason !== null && (
            // A radio cannot be un-picked, and an answer given by accident
            // would otherwise be recorded as a considered one.
            <Button variant="ghost" size="sm" onClick={() => setReason(null)}>
              Clear
            </Button>
          )}

          <div className="space-y-1">
            <Textarea
              value={detail}
              onChange={(event) =>
                setDetail(event.target.value.slice(0, DETAIL_MAX))
              }
              rows={3}
              placeholder="Anything else worth telling us?"
              aria-label="Anything else worth telling us (optional)"
            />
            {detail.length > DETAIL_MAX - DETAIL_COUNTDOWN_FROM && (
              <p className="text-xs text-muted-foreground">
                {DETAIL_MAX - detail.length} characters left.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{CANCEL_EXPORT_TITLE}</p>
          <p className="text-sm text-muted-foreground">{CANCEL_EXPORT_NOTE}</p>
          <Button
            variant="outline"
            onClick={runExport}
            disabled={exportContacts.isPending}
          >
            <Download strokeWidth={1.75} aria-hidden />
            {exportContacts.isPending ? "Exporting…" : CANCEL_EXPORT_ACTION}
          </Button>
          {exportError && (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{CANCEL_SKIP_NOTE}</p>
          {/* The only primary button in the card, and the last thing in it.
              Disabled by the in-flight request and by nothing else: an
              unanswered question must never hold the door shut. */}
          <Button disabled={portal.isPending} onClick={leave}>
            {portal.isPending ? "Opening…" : CANCEL_ACTION}
            <ExternalLink strokeWidth={1.75} aria-hidden />
          </Button>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Last, and after the exit on purpose — see the docblock. It appears
            only once a reason has been picked, so a plain arrival on this
            screen is byte-for-byte the screen it was before this shipped. */}
        {offer && <CancellationAnswer offer={offer} company={company} />}
      </div>
    </SettingsCard>
  );
}
