"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api/error";
import { useReleaseNumber } from "@/lib/api/numbers";
import type { PhoneNumberSummary } from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";

import { ChooseNumberDialog } from "./choose-number-dialog";

/** Customer-facing provisioning copy — exact strings (SPEC §4.4). */
const STATUS_COPY: Partial<Record<PhoneNumberSummary["status"], string>> = {
  provisioning: "Setting up your business number, usually under a minute.",
};

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
function failedCopy(n: PhoneNumberSummary): string {
  if (!needsNumberChoice(n)) {
    return "We're still setting up your number. This is taking a little longer than usual.";
  }
  if (n.failure_reason === "no_inventory" && n.requested_area_code) {
    return `Area code ${n.requested_area_code} is out of new numbers right now. Choose another number to finish setup.`;
  }
  return "We couldn't finish setting up your number. Choose a number to try again.";
}

function StatusBadge({ number }: { number: PhoneNumberSummary }) {
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
          Active
        </Badge>
      );
    case "provisioning":
      return amber("Setting up");
    case "provision_failed":
      // The lie ends here: a stuck provision (no inventory / out of attempts) is
      // a DISTINCT destructive state, never the same amber "Setting up" as a
      // number that's actually still being set up.
      return needsNumberChoice(number) ? (
        <Badge className="border-transparent bg-destructive/10 text-destructive">
          Couldn&apos;t set up
        </Badge>
      ) : (
        amber("Setting up")
      );
    case "suspended":
      return amber("Suspended");
    case "released":
      return <Badge variant="secondary">Released</Badge>;
  }
}

/** Typed-confirmation release (G8): the owner types the number to confirm. */
function ReleaseNumberDialog({
  number,
  open,
  onOpenChange,
}: {
  number: PhoneNumberSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const release = useReleaseNumber();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const display = number.number_e164 ? formatPhone(number.number_e164) : "";
  const expectedDigits = (number.number_e164 ?? "").replace(/\D/g, "");
  const typedDigits = typed.replace(/\D/g, "");
  const matches =
    expectedDigits !== "" &&
    (typedDigits === expectedDigits ||
      `1${typedDigits}` === expectedDigits);

  function close(next: boolean) {
    if (!next) {
      setTyped("");
      setError(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release {display}?</DialogTitle>
          <DialogDescription>
            This gives the number up for good. Customers who text it won&apos;t
            reach you, and you can&apos;t get the same number back. Type the
            number to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="release-confirm">Type {display} to confirm</Label>
          <Input
            id="release-confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={display}
            autoComplete="off"
            inputMode="tel"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Keep the number
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || release.isPending}
            onClick={() =>
              release.mutate(number.id, {
                onSuccess: () => {
                  close(false);
                  toast.success(`${display} released.`);
                },
                onError: (cause) =>
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Couldn't release the number. Try again.",
                  ),
              })
            }
          >
            {release.isPending ? "Releasing…" : "Release number"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NumberCard({ number }: { number: PhoneNumberSummary }) {
  const { role } = useActiveCompany();
  const [releasing, setReleasing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const released = number.status === "released";
  const canManage = role === "owner" || role === "admin";

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
            : `Area code ${number.requested_area_code ?? "–"}`}
        </p>
        {number.number_e164 && !released && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy number"
            onClick={() => {
              void navigator.clipboard.writeText(number.number_e164 as string);
              toast.success("Number copied.");
            }}
          >
            <Copy strokeWidth={1.75} />
          </Button>
        )}
        <div className="ml-auto">
          <StatusBadge number={number} />
        </div>
      </div>
      {number.status === "provisioning" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {STATUS_COPY.provisioning}
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
          {failedCopy(number)}
        </p>
      )}
      {number.status === "suspended" && (
        <p className="mt-2 text-sm text-muted-foreground">
          Texting is paused.{" "}
          <Link
            href="/settings/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Update your payment method
          </Link>{" "}
          to turn it back on.
        </p>
      )}
      {released && number.released_at && (
        <p className="mt-2 text-sm text-muted-foreground">
          Released{" "}
          {new Date(number.released_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          .
        </p>
      )}
      {canManage && number.status === "provision_failed" && (
        <div className="mt-3 border-t pt-3">
          <Button size="sm" onClick={() => setChoosing(true)}>
            Choose a number
          </Button>
          <ChooseNumberDialog
            number={number}
            open={choosing}
            onOpenChange={setChoosing}
          />
        </div>
      )}
      {role === "owner" && !released && number.number_e164 && (
        <div className="mt-3 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
            onClick={() => setReleasing(true)}
          >
            Release this number…
          </Button>
          <ReleaseNumberDialog
            number={number}
            open={releasing}
            onOpenChange={setReleasing}
          />
        </div>
      )}
    </div>
  );
}
