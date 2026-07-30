"use client";

import { useCallback } from "react";

import {
  explainRejection,
  needsHumanHelp,
  RESUBMISSION_WAIT,
  supportMailto,
  type RejectionDomain,
} from "@loonext/shared";

import { Button } from "@/components/ui/button";

/**
 * #352 — what a rejected customer reads, and the one thing they do next.
 *
 * `docs/DESIGN.md` G7 has always required *"rejection reason in plain language
 * + 'Fix and resubmit' form"*. The form shipped; the plain language did not.
 * What a customer saw was the carrier's own token — `BRAND_LEGAL_NAME_MISMATCH`
 * — followed immediately by seventeen fields and the claim that it takes two
 * minutes.
 *
 * DESIGN NOTES, because each part is answering a specific failure:
 *
 * **Two sentences, in G10's shape** (*"what happened + what to do, one sentence
 * each"*). The old copy had only the first half, in a vocabulary written for
 * registration professionals.
 *
 * **A jump to the field.** A customer who has just been told no and is handed a
 * seventeen-field form is being asked to hold far more than the three or four
 * things anyone can hold at once, so the most likely outcome is that they
 * re-enter what they already had and buy another multi-day carrier review with
 * it. The button is the whole fix for that: it moves them to the one input that
 * was wrong.
 *
 * **The carrier's own words stay on screen.** Demoted, never hidden. When the
 * catalogue does not recognise a reason the raw text is all the customer has,
 * and #352 is explicit that showing it beats a generic sentence *"that hides
 * it"*. Keeping it visible in BOTH cases also means a support conversation can
 * quote the same string the customer is looking at.
 *
 * **The wait is stated.** *"A second wait of unknown length after a rejection,
 * with no stated ceiling, is where people give up."*
 *
 * **The second rejection offers a person, not a form.** By then the customer has
 * demonstrated they cannot tell from what we have shown them what is wrong, and
 * a third solo attempt costs them another carrier review to learn the same
 * thing.
 */
export function RejectionNotice({
  domain,
  reason,
  submissionCount,
  formRef,
  company,
}: {
  domain: RejectionDomain;
  reason: string | null;
  submissionCount: number | null;
  /** The fix form, so a field can be focused without a global query. */
  formRef: React.RefObject<HTMLDivElement | null>;
  /** Carried into the support mailto so a stuck customer does not retype it. */
  company: { id: string; name: string; plan: string | null };
}) {
  const guidance = explainRejection(domain, reason);
  const stuck = needsHumanHelp(submissionCount);
  // Said whichever way round, because the same component serves both and
  // "registration" on a port rejection would read as the wrong thing failing.
  const subject = domain === "port" ? "transfer" : "registration";

  const goToField = useCallback(() => {
    const field = guidance?.field;
    if (!field) return;
    const input = formRef.current?.querySelector<HTMLElement>(
      `[name="${CSS.escape(field)}"]`,
    );
    if (!input) return;
    // Centred rather than at the top: a focused input pinned under the card
    // header reads as "nothing happened" on a short viewport.
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }, [guidance?.field, formRef]);

  return (
    <div className="space-y-2 rounded-md bg-warning/10 px-3 py-2">
      <p className="text-sm font-medium">
        {guidance
          ? guidance.what
          : `The carrier turned down this ${subject} and did not say why in a way we can translate.`}
      </p>
      <p className="text-sm">
        {guidance
          ? guidance.fix
          : "Check the details below against your official registration paperwork, and reply to us if nothing looks wrong."}
      </p>

      {/* Carrier-authored: unbounded, and frequently one long token. */}
      {reason ? (
        <p className="break-words text-xs text-muted-foreground">
          The carrier said: {reason}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {RESUBMISSION_WAIT[domain]}
      </p>

      {(guidance?.field || stuck) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {guidance?.field ? (
            <Button size="sm" variant="secondary" onClick={goToField}>
              Take me to it
            </Button>
          ) : null}
          {stuck ? (
            // Second rejection. Offered alongside the form rather than instead
            // of it — somebody who now knows what to change should not have to
            // wait for us to reply before changing it.
            <Button size="sm" variant="outline" asChild>
              <a
                href={supportMailto({
                  companyId: company.id,
                  companyName: company.name,
                  plan: company.plan,
                  platform: "web",
                  subject:
                    domain === "port"
                      ? "My number transfer keeps getting rejected"
                      : "My registration keeps getting rejected",
                })}
              >
                Get help from us
              </a>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
