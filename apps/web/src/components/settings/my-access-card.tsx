"use client";

import { useQuery } from "@tanstack/react-query";
import {
  numberAccessLevelLabel,
  numberAccessReason,
  numberAccessSelfNote,
  sortNumberAccessExplanations,
  type NumberAccessExplanation,
} from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { apiFetch } from "@/lib/api/client";
import { useCompanyId } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

/**
 * #286 — what a member cannot reach, and why.
 *
 * # The failure this replaces
 *
 * A member used to be told a COUNT: "2 more numbers are on this account that
 * are not shared with you. Ask an owner if you need them." #286's complaint is
 * that last sentence — *"silent absence is the worse failure"* — and asking
 * the owner one number at a time is the cost the new tech pays for our
 * reticence. They cannot tell a deliberate restriction from the app being
 * broken, and neither can the owner they interrupt.
 *
 * So this names the numbers and the RULE. "A rule for members" tells them
 * something true and closes the question; a count does not.
 *
 * # It lists only what is restricted
 *
 * The numbers they can fully use are already the cards above this one, and
 * repeating them would make this a second copy of the same list rather than an
 * answer to the question the reader actually has. *Applying: Zen of Clarity.*
 *
 * # It says nothing to somebody with nothing to explain
 *
 * A member who reaches everything, and every owner and admin — who reach every
 * number by definition — see no card at all. A panel reassuring somebody about
 * a problem they do not have is furniture, and furniture is not read.
 *
 * # The words come from shared code
 *
 * The same seven clauses #348 wrote for the owner-facing screen, read by the
 * person they are about. A second set written for members would be a second
 * wording of one security rule.
 */
export function MyAccessCard() {
  const companyId = useCompanyId();
  const access = useQuery({
    queryKey: ["my-number-access", companyId],
    queryFn: () =>
      apiFetch<{ numbers: NumberAccessExplanation[] }>("/v1/numbers/access/me", {
        companyId,
      }),
  });

  const rows = access.data?.numbers ?? [];
  const note = numberAccessSelfNote(rows);
  // Nothing restricted — the commonest case, and the one that earns silence.
  if (note === null) return null;

  const restricted = sortNumberAccessExplanations(rows).filter(
    (row) => row.level !== "text",
  );

  return (
    <SettingsCard
      title="What you can reach"
      description="Some of this workspace's numbers are not shared with you. Here is which, and what decided it."
    >
      <div className="space-y-3">
        <p role="status" className="text-sm">
          {note}
        </p>
        <ul className="space-y-2">
          {restricted.map((row) => (
            <li
              key={row.phone_number_id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border-subtle pb-2 last:border-b-0 last:pb-0"
            >
              <span className="min-w-[9rem] text-sm tabular-nums">
                {row.number_e164 ? formatPhone(row.number_e164) : "A number"}
              </span>
              <span className="text-sm text-muted-foreground">
                {numberAccessLevelLabel(row.level)}
              </span>
              <span className="w-full text-[12px] text-app-muted-2 sm:ml-auto sm:w-auto">
                {numberAccessReason(row.decided_by, row.principal, "self")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SettingsCard>
  );
}
