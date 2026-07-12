"use client";

/**
 * D43 (#135) dialer — call ANY number, not just someone you've already texted.
 * A keypad places the call through the softphone via POST /v1/calls/browser
 * with a raw `to` (the server normalizes + NANP-validates it and resolves which
 * business number to present). Threading find-or-creates the contact +
 * conversation on answer, so a dialed stranger still lands in the inbox.
 */
import { Delete, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/error";
import { useNumbers } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";
import { useSoftphone } from "@/lib/softphone/provider";

const KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "*",
  "0",
  "#",
] as const;

export function Dialer({ trigger }: { trigger: ReactNode }) {
  const softphone = useSoftphone();
  const numbers = useNumbers();
  const active = (numbers.data?.data ?? []).filter(
    (n): n is typeof n & { number_e164: string } =>
      n.status === "active" && Boolean(n.number_e164),
  );

  const [open, setOpen] = useState(false);
  const [digits, setDigits] = useState("");
  const [fromId, setFromId] = useState<string | undefined>(undefined);
  const [calling, setCalling] = useState(false);

  // The server does the authoritative NANP validation; this just gates the
  // Call button so an obviously-too-short number can't be dialed.
  const canCall = digits.replace(/\D/g, "").length >= 10 && !calling;

  function press(key: string) {
    setDigits((d) => (d.length >= 18 ? d : d + key));
  }

  async function call() {
    if (!softphone) {
      toast.error("Calling isn't available right now. Try reloading the app.");
      return;
    }
    setCalling(true);
    try {
      await softphone.placeCall({
        to: digits,
        // Only pin a caller-ID number when the company owns several; a
        // single-number company lets the server imply it.
        phoneNumberId:
          active.length > 1 ? (fromId ?? active[0]?.id) : undefined,
        contactName: digits,
      });
      setOpen(false);
      setDigits("");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "Couldn't start the call.",
      );
    } finally {
      setCalling(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDigits("");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Dial a number</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="min-h-[2.25rem] text-center text-2xl font-medium tabular-nums tracking-wide">
            {digits || (
              <span className="text-app-muted-2">Enter a number</span>
            )}
          </div>

          {active.length > 1 && (
            <Select value={fromId ?? active[0]?.id} onValueChange={setFromId}>
              <SelectTrigger aria-label="Call from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {active.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    From {formatPhone(n.number_e164)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                className="rounded-xl border border-app-line py-3 text-lg font-medium text-app-ink transition-colors duration-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {key}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              onClick={() => void call()}
              disabled={!canCall}
            >
              <Phone strokeWidth={1.75} />
              Call
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDigits((d) => d.slice(0, -1))}
              disabled={!digits}
              aria-label="Delete last digit"
            >
              <Delete strokeWidth={1.75} />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
