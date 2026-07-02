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

/** SPEC §4.4 customer-facing provisioning copy — exact strings. */
const STATUS_COPY: Partial<Record<PhoneNumberSummary["status"], string>> = {
  provisioning: "Setting up your business number — usually under a minute.",
  provision_failed:
    "We're setting up your number — this is taking longer than usual. You don't need to do anything.",
};

function StatusBadge({ status }: { status: PhoneNumberSummary["status"] }) {
  switch (status) {
    case "active":
      return (
        <Badge className="border-transparent bg-success/10 text-success">
          Active
        </Badge>
      );
    // Amber badge text is amber-800 in light (status-pill convention):
    // --warning (amber-600) misses the G11 4.5:1 bar as text on the tint.
    case "provisioning":
    case "provision_failed":
      return (
        <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
          Setting up
        </Badge>
      );
    case "suspended":
      return (
        <Badge className="border-transparent bg-warning/10 text-amber-800 dark:bg-warning/15 dark:text-warning">
          Suspended
        </Badge>
      );
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
  const released = number.status === "released";

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
            : `Area code ${number.requested_area_code ?? "—"}`}
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
          <StatusBadge status={number.status} />
        </div>
      </div>
      {STATUS_COPY[number.status] && (
        <p className="mt-2 text-sm text-muted-foreground">
          {STATUS_COPY[number.status]}
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
