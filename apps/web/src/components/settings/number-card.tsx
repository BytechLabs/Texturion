"use client";

import { roleHasCapability } from "@loonext/shared";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberAccessDialog } from "@/components/settings/number-access-dialog";
import { NumberHoursDialog } from "@/components/settings/number-hours-dialog";
import { NumberIdentityDialog } from "@/components/settings/number-identity-dialog";
import { NumberHealthNotice } from "@/components/settings/number-health-notice";
import type { NumberHoldState } from "@/components/settings/number-hold";
import { NumberHoldNote } from "@/components/settings/number-hold-note";
import { mayReleaseNumber } from "@/components/settings/release-number";
import { ReleaseNumberDialog } from "@/components/settings/release-number-dialog";
import { useT, type Translate } from "@/i18n/provider";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

import { provisioningWaitCopy } from "@/components/registration/copy";
import { useNow } from "@/lib/use-now";

import { ChooseNumberDialog } from "./choose-number-dialog";

/**
 * A provision_failed number the automatic retry loop can't fix on its own — the
 * requested area code is out of inventory, or we're out of attempts — so the
 * user must choose another number to finish setup. A transient failure the cron
 * is still retrying is NOT this. (The "Choose a number" action ships with the
 * remediation phase; here we already stop the lie and tell the honest truth.)
 */
function needsNumberChoice(n: PhoneNumberSummary): boolean {
  return (
    n.status === "provision_failed" &&
    (n.failure_reason === "no_inventory" || (n.provision_attempts ?? 0) >= 5)
  );
}

/** Honest, reason-driven copy for a provision_failed number. */
function failedCopy(n: PhoneNumberSummary, t: Translate): string {
  if (!needsNumberChoice(n)) {
    return t("settingsMore.numberSetupSlow");
  }
  if (n.failure_reason === "timeout") {
    // A Telnyx order that stalled — nothing broke, and the paid slot is intact.
    return t("settingsMore.numberSetupStalled");
  }
  if (n.failure_reason === "no_inventory" && n.requested_area_code) {
    return t("settingsMore.numberAreaCodeEmpty", {
      code: n.requested_area_code,
    });
  }
  return t("settingsMore.numberSetupFailed");
}

function StatusBadge({ number }: { number: PhoneNumberSummary }) {
  const t = useT();
  // Amber badge text is amber-800 in light (status-pill convention):
  // --warning (amber-600) misses the G11 4.5:1 bar as text on the tint.
  const amber = (label: string) => (
    <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
      {label}
    </Badge>
  );
  switch (number.status) {
    case "active":
      return (
        <Badge className="border-transparent bg-success/10 text-success">
          {t("settingsMore.numberStatusActive")}
        </Badge>
      );
    case "provisioning":
      return amber(t("settingsMore.numberStatusSettingUp"));
    case "provision_failed":
      // The lie ends here: a stuck provision is a DISTINCT state, never the same
      // amber "Setting up" as a number actually still being set up. A 'timeout'
      // (a Telnyx order that stalled) is a calm amber "Action needed" — nothing
      // broke, just pick a number; a real failure (no inventory / out of
      // attempts) is the red "Couldn't set up".
      if (!needsNumberChoice(number))
        return amber(t("settingsMore.numberStatusSettingUp"));
      return number.failure_reason === "timeout" ? (
        amber(t("settingsMore.numberStatusActionNeeded"))
      ) : (
        <Badge className="border-transparent bg-destructive/10 text-destructive">
          {t("settingsMore.numberStatusSetupFailed")}
        </Badge>
      );
    case "suspended":
      return amber(t("settingsMore.numberStatusSuspended"));
    case "released":
      return (
        <Badge variant="secondary">
          {t("settingsMore.numberStatusReleased")}
        </Badge>
      );
  }
}

import { ringCeilingLine } from "./ring-ceiling";

export function NumberCard({
  number,
  hold,
  subscriptionActive = false,
}: {
  number: PhoneNumberSummary;
  /**
   * #523: why this number is suspended, when the caller was able to find out.
   *
   * Optional so a caller that never renders a suspended row does not have to
   * resolve it, and so the numbers screen stays the one place that decides
   * whether the billing route may be asked at all.
   */
  hold?: NumberHoldState | null;
  /**
   * #523: whether the subscription is live, which is half of the release rule —
   * see `mayReleaseNumber` for why a past-due workspace is not offered an
   * irreversible control.
   *
   * Defaulted FALSE rather than true, so a caller that has not been taught the
   * rule withholds the destructive control on a held line instead of offering
   * one it should not. It costs nothing on a working number: `active` releases
   * regardless of this flag, which is every ordinary card on the screen.
   */
  subscriptionActive?: boolean;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const [releasing, setReleasing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [managingAccess, setManagingAccess] = useState(false);
  const [managingIdentity, setManagingIdentity] = useState(false);
  const [managingHours, setManagingHours] = useState(false);
  const now = useNow();
  const released = number.status === "released";
  const canManage = role === "owner" || role === "admin";
  const canRelease =
    roleHasCapability(role, "workspace.own") &&
    mayReleaseNumber(number.status, number.number_e164, subscriptionActive);

  return (
    <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          className={
            released
              ? "text-xl font-medium tabular-nums text-muted-foreground line-through"
              : "text-xl font-medium tabular-nums"
          }
        >
          {number.number_e164
            ? formatPhone(number.number_e164)
            : t("settingsMore.numberAreaCode", {
                code: number.requested_area_code ?? "–",
              })}
        </p>
        {number.number_e164 && !released && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("settingsMore.numberCopyAria")}
            onClick={() => {
              // Only claim success once the write actually resolves — a denied
              // clipboard permission or an insecure context rejects, and a
              // false "copied" toast leaves the user pasting stale data.
              void navigator.clipboard
                .writeText(number.number_e164 as string)
                .then(() => toast.success(t("settingsMore.numberCopied")))
                .catch(() => toast.error(t("settingsMore.numberCopyFailed")));
            }}
          >
            <Copy strokeWidth={1.75} />
          </Button>
        )}
        <div className="ml-auto">
          <StatusBadge number={number} />
        </div>
      </div>
      {/* #366: a crew bigger than one call can ring. Shown to EVERY member,
          not only owners, because the person who most needs it is the tech
          wondering why their phone rings less than a colleague's — and with
          the fan-out now rotating per call, the honest thing to say is about
          the workspace rather than about them.
          *Applying: G1.5 — every async state visible, named and honest.* */}
      {ringCeilingLine(number, t) !== null && (
        <p className="mt-2 text-sm text-muted-foreground">
          {ringCeilingLine(number, t)}
        </p>
      )}
      {number.status === "provisioning" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {provisioningWaitCopy(number.created_at, now)}
        </p>
      )}
      {number.status === "provision_failed" && (
        <p
          className={
            needsNumberChoice(number)
              ? "mt-2 text-sm text-foreground"
              : "mt-2 text-sm text-muted-foreground"
          }
        >
          {failedCopy(number, t)}
        </p>
      )}
      {/* #235: a carrier is filtering this line. Only ever shown for the
          confident 'degraded' state — the server never sends 'watch'. */}
      {number.status === "active" && number.health && (
        <NumberHealthNotice health={number.health} />
      )}
      {/* #523: a suspended number has TWO causes now, and they need opposite
          advice. `hold` carries which one applies — see `number-hold.ts` for
          why the third answer is "we don't know" and why that is not guessed
          at. Absent `hold` (a caller that has not been taught the difference)
          falls through to the same neutral sentence as "unknown", which asserts
          no cause rather than picking the wrong one. The sentence itself lives
          in `NumberHoldNote` because the port stepper has to say the SAME thing
          about a transferred line that went on hold. */}
      {number.status === "suspended" && (
        <NumberHoldNote hold={hold} className="mt-2" />
      )}
      {released && number.released_at && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settingsMore.numberReleasedOn", {
            date: new Date(number.released_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          })}
        </p>
      )}
      {canManage && number.status === "provision_failed" && (
        <div className="mt-3 border-t pt-3">
          <Button size="sm" onClick={() => setChoosing(true)}>
            {t("settingsMore.numberChooseAction")}
          </Button>
          <ChooseNumberDialog
            number={number}
            open={choosing}
            onOpenChange={setChoosing}
          />
        </div>
      )}
      {canManage && !released && number.number_e164 && (
        <div className="mt-3 border-t pt-3">
          {/* #106: per-number access — who can use it, at what level. */}
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setManagingAccess(true)}
          >
            {t("settingsMore.numberWhoCanUseAction")}
          </Button>
          <NumberAccessDialog
            numberId={number.id}
            numberLabel={formatPhone(number.number_e164)}
            open={managingAccess}
            onOpenChange={setManagingAccess}
          />
          {/* #307: how the line ANSWERS, beside who can use it. The two are
              the same kind of question about one number, and a second number
              is a second business — the greeting, the name on a missed-call
              text and the after-hours reply should be able to differ. */}
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setManagingIdentity(true)}
          >
            {t("settingsMore.numberHowItAnswersAction")}
          </Button>
          <NumberIdentityDialog
            numberId={number.id}
            open={managingIdentity}
            onOpenChange={setManagingIdentity}
          />
          {/*
            #307: a SECOND entry rather than more rows in the first dialog.
            "How this line answers" is already five fields, and when the line
            is open is a different question asked at a different time.
          */}
          <Button
            variant="link"
            className="h-auto p-0 text-[13px]"
            onClick={() => setManagingHours(true)}
          >
            {t("settingsMore.numberWhenOpenAction")}
          </Button>
          <NumberHoursDialog
            numberId={number.id}
            open={managingHours}
            onOpenChange={setManagingHours}
          />
        </div>
      )}
      {/* #523: ONE release rule across the three clients — see
          `release-number.ts` for the three answers this replaces and why
          Android's won. Two independent gates on purpose: `workspace.own` is
          the same capability `DELETE /v1/numbers/:id` requires, and the
          lifecycle question is asked separately so a role change can never
          quietly become a lifecycle change. */}
      {canRelease && (
        <div className="mt-3 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
            onClick={() => setReleasing(true)}
          >
            {t("settingsMore.numberReleaseAction")}
          </Button>
          <ReleaseNumberDialog
            number={number}
            /* The words and the control have to be about the same state — a
               held number's confirmation promises a free replacement it cannot
               deliver unless this is passed. */
            hold={hold}
            open={releasing}
            onOpenChange={setReleasing}
          />
        </div>
      )}
    </div>
  );
}
