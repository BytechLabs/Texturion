"use client";

/**
 * D38 click-to-call. With the voice module on, the thread's Call button
 * dials the MEMBER'S cell from the business number, then bridges to the
 * customer — the customer sees the business number and personal cells stay
 * private (the old bare `tel:` link leaked them). First use collects the
 * member's cell in a small dialog (self-service, per membership). With the
 * module off, the button degrades to the original `tel:` link — never a
 * dead control.
 */
import { Phone } from "lucide-react";
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
import { useModules } from "@/lib/api/billing";
import { useCallCell, useSetCallCell, useStartCall } from "@/lib/api/calls";
import { ApiError } from "@/lib/api/error";

const CELL_HINT = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

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
  const modules = useModules();
  const cell = useCallCell();
  const setCell = useSetCallCell();
  const startCall = useStartCall();
  const [cellDialogOpen, setCellDialogOpen] = useState(false);
  const [draftCell, setDraftCell] = useState("");
  const [error, setError] = useState<string | null>(null);

  const voiceOn =
    modules.data?.modules.some((m) => m.id === "voice" && m.enabled) ?? false;

  // Module off (or still loading) → the original tel: link, unchanged.
  if (!voiceOn) {
    return (
      <Button
        asChild
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={`Call ${contactName}`}
      >
        <a href={`tel:${phone}`}>
          <Phone className="size-4" strokeWidth={1.75} />
        </a>
      </Button>
    );
  }

  function dial() {
    startCall.mutate(conversationId, {
      onSuccess: () =>
        toast.success(
          `Calling your cell now — pick up and we'll connect you to ${contactName}.`,
        ),
      onError: (cause) =>
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't start the call. Try again.",
        ),
    });
  }

  function onClick() {
    if (cell.data?.call_cell_e164) {
      dial();
      return;
    }
    setError(null);
    setDraftCell("");
    setCellDialogOpen(true);
  }

  function saveCellAndDial() {
    const trimmed = draftCell.trim();
    if (!CELL_HINT.test(trimmed)) {
      setError("Enter a US or Canada mobile number like +16135551234.");
      return;
    }
    setCell.mutate(trimmed, {
      onSuccess: () => {
        setCellDialogOpen(false);
        dial();
      },
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Couldn't save. Try again.",
        ),
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className={className}
        aria-label={`Call ${contactName} from your business number`}
        onClick={onClick}
        disabled={startCall.isPending}
      >
        <Phone className="size-4" strokeWidth={1.75} />
      </Button>

      <Dialog open={cellDialogOpen} onOpenChange={setCellDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where should we ring you?</DialogTitle>
            <DialogDescription>
              We call your cell first, then connect you to {contactName}.
              They&apos;ll see your business number, not your cell.
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
              onClick={() => setCellDialogOpen(false)}
              disabled={setCell.isPending}
            >
              Cancel
            </Button>
            <Button onClick={saveCellAndDial} disabled={setCell.isPending}>
              {setCell.isPending ? "Saving…" : "Save and call"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
