"use client";

/**
 * D38 click-to-call. With the voice module on, the thread's Call button
 * dials the MEMBER'S cell from the business number, then bridges to the
 * customer — the customer sees the business number and personal cells stay
 * private (the old bare `tel:` link leaked them). First use collects the
 * member's cell in a small dialog and — D40 (#133) — VERIFIES it with a
 * texted code before anything can dial it (possession, not just syntax:
 * a typo would ring a stranger with the business number). With the module
 * off, the button opens an honest explain-and-upsell dialog with an
 * explicit tel: escape hatch (#133 — the old silent tel: fallback read as
 * broken and quietly dialed from the personal cell); while the module state
 * is still LOADING or errored it renders disabled.
 *
 * After a dial is accepted the button holds a "calling" state for the agent
 * ring window instead of instantly re-arming — the server refuses a second
 * concurrent bridge per conversation anyway (#133), this just keeps the UI
 * honest about it.
 */
import { Phone, PhoneOutgoing } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

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
import {
  useCallCell,
  useSetCallCell,
  useStartCall,
  useVerifyCallCell,
} from "@/lib/api/calls";
import { useCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";

const CELL_HINT = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
const CODE_HINT = /^\d{6}$/;
/** Hold the button disabled for the agent-leg ring window after a 202. */
const DIALING_HOLD_MS = 30_000;

export function CallButton({
  conversationId,
  contactName,
  phone,
  className,
}: {
  conversationId: string;
  contactName: string;
  phone: string;
  className?: string;
}) {
  // #133: module state comes from the MEMBER-visible company view —
  // GET /v1/billing/modules is admin-only, so gating on it made every
  // member read as module-off (the tel: personal-cell leak).
  const company = useCompany();
  const cell = useCallCell();
  const setCell = useSetCallCell();
  const verifyCell = useVerifyCallCell();
  const startCall = useStartCall();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<"cell" | "code">("cell");
  const [draftCell, setDraftCell] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);

  const voiceOn =
    company.data?.enabled_modules.includes("voice") ?? false;

  // Module state still loading OR unknown (a transient error) → a disabled
  // button, never the tel: fallback (a voice-subscribed member clicking in
  // that window would dial from their personal cell — the exact leak D38
  // closed; #133 review: an errored query re-opened it too).
  if (company.isPending || company.isError) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={`Call ${contactName}`}
        disabled
      >
        <Phone className="size-4" strokeWidth={1.75} />
      </Button>
    );
  }

  // Module off → an HONEST affordance (#133 follow-up): the old silent tel:
  // fallback read as broken ("why is the call button just a tel: link?") and
  // quietly dialed from the member's personal cell. Clicking now explains
  // that Calling is off, points at Settings › Billing, and keeps the tel:
  // escape hatch as an explicit, labeled choice — never a dead control,
  // never a surprise personal-cell dial.
  if (!voiceOn) {
    return <ModuleOffCallButton contactName={contactName} phone={phone} className={className} />;
  }

  function dial() {
    startCall.mutate(conversationId, {
      onSuccess: () => {
        toast.success(
          `Calling your cell now — pick up and we'll connect you to ${contactName}.`,
        );
        setDialing(true);
        window.setTimeout(() => setDialing(false), DIALING_HOLD_MS);
      },
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't start the call. Try again.",
        ),
    });
  }

  function onClick() {
    if (cell.data?.call_cell_e164 && cell.data.verified) {
      dial();
      return;
    }
    setError(null);
    setDraftCell(cell.data?.call_cell_e164 ?? "");
    setDraftCode("");
    // #133 review: a saved-but-unverified cell opens ON the code step — the
    // member may already hold a valid code (dialog closed mid-flow), and
    // landing on the cell step forced a cooldown-blocked re-send with no way
    // to enter it. "Resend code" lives on the code step; "Change number"
    // goes back.
    setStep(cell.data?.call_cell_e164 ? "code" : "cell");
    setDialogOpen(true);
  }

  function resendCode() {
    const trimmed = draftCell.trim();
    if (!CELL_HINT.test(trimmed)) {
      setError("Enter a US or Canada mobile number like +16135551234.");
      return;
    }
    setError(null);
    setCell.mutate(trimmed, {
      onSuccess: () => setDraftCode(""),
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't resend. Try again.",
        ),
    });
  }

  function saveCellAndSendCode() {
    const trimmed = draftCell.trim();
    if (!CELL_HINT.test(trimmed)) {
      setError("Enter a US or Canada mobile number like +16135551234.");
      return;
    }
    setError(null);
    setCell.mutate(trimmed, {
      onSuccess: (data) => {
        if (data.verified) {
          // Saved the number that was already verified — just call.
          setDialogOpen(false);
          dial();
          return;
        }
        setStep("code");
      },
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't save. Try again.",
        ),
    });
  }

  function verifyAndDial() {
    const trimmed = draftCode.trim();
    if (!CODE_HINT.test(trimmed)) {
      setError("Enter the 6-digit code we texted you.");
      return;
    }
    setError(null);
    verifyCell.mutate(trimmed, {
      onSuccess: () => {
        setDialogOpen(false);
        dial();
      },
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "That didn't work. Try again.",
        ),
    });
  }

  const busy = startCall.isPending || dialing;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={
          busy
            ? "Calling your cell…"
            : `Call ${contactName} from your business number`
        }
        onClick={onClick}
        disabled={busy}
      >
        {busy ? (
          <PhoneOutgoing className="size-4 animate-pulse" strokeWidth={1.75} />
        ) : (
          <Phone className="size-4" strokeWidth={1.75} />
        )}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          {step === "cell" ? (
            <>
              <DialogHeader>
                <DialogTitle>Where should we ring you?</DialogTitle>
                <DialogDescription>
                  We call your cell first, then connect you to {contactName}.
                  They&apos;ll see your business number, not your cell.
                  We&apos;ll text your cell a code to confirm it&apos;s yours.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="call-cell">Your cell</Label>
                <Input
                  id="call-cell"
                  type="tel"
                  inputMode="tel"
                  placeholder="+16135551234"
                  value={draftCell}
                  onChange={(e) => setDraftCell(e.target.value)}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={setCell.isPending}
                >
                  Cancel
                </Button>
                <Button onClick={saveCellAndSendCode} disabled={setCell.isPending}>
                  {setCell.isPending ? "Texting a code…" : "Text me a code"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Enter the code we texted you</DialogTitle>
                <DialogDescription>
                  We texted a 6-digit code to {draftCell.trim()} from your
                  business number. Enter it here and we&apos;ll place the call.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="call-cell-code">Code</Label>
                <Input
                  id="call-cell-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={draftCode}
                  onChange={(e) => setDraftCode(e.target.value)}
                />
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={resendCode}
                  disabled={setCell.isPending || verifyCell.isPending}
                >
                  {setCell.isPending ? "Sending…" : "Resend code"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setStep("cell");
                  }}
                  disabled={verifyCell.isPending}
                >
                  Change number
                </Button>
                <Button onClick={verifyAndDial} disabled={verifyCell.isPending}>
                  {verifyCell.isPending ? "Checking…" : "Confirm and call"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Module-off state: explain, upsell, and keep an explicit tel: escape hatch. */
function ModuleOffCallButton({
  contactName,
  phone,
  className,
}: {
  contactName: string;
  phone: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={`Call ${contactName}`}
        onClick={() => setOpen(true)}
      >
        <Phone className="size-4" strokeWidth={1.75} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Calling is off for this workspace</DialogTitle>
            <DialogDescription>
              With the Calling add-on, this button rings your cell first and
              connects you to {contactName} from your business number — they
              never see your personal cell. Right now the add-on is off.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild variant="outline">
              <a href={`tel:${phone}`} onClick={() => setOpen(false)}>
                Call from this phone instead
              </a>
            </Button>
            <Button asChild>
              <Link href="/settings/billing" onClick={() => setOpen(false)}>
                Turn on Calling
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
