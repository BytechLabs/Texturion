"use client";

/**
 * D43 (#135) dialer — call ANY number, not just someone you've already texted.
 * A keypad places the call through the softphone via POST /v1/calls/browser
 * with a raw `to` (the server normalizes + NANP-validates it and resolves which
 * business number to present). Threading find-or-creates the contact +
 * conversation on answer, so a dialed stranger still lands in the inbox.
 *
 * #459 — the keypad is also a name search. The letters printed on a phone key
 * are not decoration: 2 is ABC, so typing 2-6-2 spells BOB, and the server
 * matches contact names by their keypad digits when asked with `t9=1`. That is
 * what makes "dial by name, from the same screen" possible with no second
 * input, because the keypad already is one.
 *
 * The matches list caps at four. Four rows is a glance and ten is a directory,
 * and the point of this screen is to reach one person quickly.
 *
 * Applying: Prioritize Intent (reaching a person is the action, so Call and
 * Message sit together rather than Message living on another screen), Zen of
 * Clarity (one primary action, one secondary, contact edits behind the match
 * row), Chunking (four results, not a scrolling list), and the Safety
 * Principle — matches render between the readout and the keypad, which is
 * where every system dialer has put them for fifteen years.
 */
import { rankDialerCandidates, type DialerMatch } from "@loonext/shared";
import { Delete, MessageSquare, Phone, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useT } from "@/i18n/provider";
import { useContacts } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import { useNumbers } from "@/lib/api/numbers";
import { formatPhone } from "@/lib/format/phone";
import { MicPermissionError, useSoftphone } from "@/lib/softphone/provider";

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
  const t = useT();
  const router = useRouter();
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

  // Who you are about to reach, from the crew's own contacts. #459: TWO digits
  // is the floor now rather than four, because two keys is a normal way to
  // reach for a name ("Bo…"). The server only widens to names when asked, so a
  // short query still means a number search unless it can also be a name.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const typed = digits.replace(/\D/g, "");
    if (typed.length < 2) {
      setDebounced("");
      return;
    }
    const timer = setTimeout(() => setDebounced(typed), 250);
    return () => clearTimeout(timer);
  }, [digits]);

  const matches = useContacts(debounced, { t9: true });
  // Ranked by the shared matcher rather than "the first row whose number
  // contains this", so an exact number beats a loose one and a first name
  // beats a surname. The phones run the SAME function over their own results
  // plus the device address book, so all three agree on who is at the top.
  const ranked: DialerMatch[] = useMemo(() => {
    if (debounced === "") return [];
    const rows = matches.data?.pages.flatMap((page) => page.data) ?? [];
    return rankDialerCandidates(
      debounced,
      rows.map((contact) => ({
        name: contact.name,
        number: contact.phone_e164,
        source: "app" as const,
        contactId: contact.id,
      })),
    );
  }, [debounced, matches.data]);

  // The person the actions act on: whoever was picked from the list, else the
  // top match for what has been typed. Picking is sticky so editing the number
  // after picking somebody does not silently retarget the call.
  const [picked, setPicked] = useState<DialerMatch | null>(null);
  const target = picked ?? ranked[0] ?? null;
  const matchedName = target?.label ?? null;

  // The server does the authoritative NANP validation; this just gates the
  // Call button so an obviously-too-short number can't be dialed.
  const canCall = digits.replace(/\D/g, "").length >= 10 && !calling;

  function press(key: string) {
    // Editing the number after choosing somebody drops the choice: a call that
    // went to the person you picked rather than the number on screen would be
    // a call nobody could explain.
    setPicked(null);
    setDigits((d) => (d.length >= 18 ? d : d + key));
  }

  function backspace() {
    setPicked(null);
    setDigits((d) => d.slice(0, -1));
  }

  /** Tapping a match fills the readout with it, which is what a keypad does. */
  function pickMatch(match: DialerMatch) {
    setPicked(match);
    setDigits(match.number.replace(/\D/g, ""));
  }

  /** #459: the same person, the other verb. */
  function message() {
    const to = picked?.number ?? digits;
    if (!to) return;
    setOpen(false);
    // The contact when we know them, the raw number when we do not — compose
    // resolves both, and passing the id means the thread opens on the person
    // rather than find-or-creating a second contact for a number we already
    // have on file.
    router.push(
      picked?.contactId
        ? `/inbox/new?contact=${encodeURIComponent(picked.contactId)}`
        : `/inbox/new?to=${encodeURIComponent(to)}`,
    );
  }

  async function call() {
    if (!softphone) {
      toast.error(t("shell.callingUnavailable"));
      return;
    }
    setCalling(true);
    try {
      // Display the number formatted on the call chip (the server still does the
      // authoritative normalization on `to`). Only NANP shapes format; anything
      // else falls back to the raw digits.
      const cleaned = digits.replace(/\D/g, "");
      const e164 =
        cleaned.length === 10
          ? `+1${cleaned}`
          : cleaned.length === 11 && cleaned.startsWith("1")
            ? `+${cleaned}`
            : digits;
      await softphone.placeCall({
        to: digits,
        // Only pin a caller-ID number when the company owns several; a
        // single-number company lets the server imply it.
        phoneNumberId:
          active.length > 1 ? (fromId ?? active[0]?.id) : undefined,
        // The name if we know it, so the call chip and the log read like a
        // person rather than a number.
        contactName: matchedName ?? formatPhone(e164),
      });
      setOpen(false);
      setDigits("");
    } catch (cause) {
      toast.error(
        // See call-button.tsx: a blocked mic and the concurrency ceiling both
        // carry actionable copy that ApiError-only narrowing threw away.
        cause instanceof MicPermissionError || cause instanceof ApiError
          ? cause.message
          : t("shell.callStartFailed"),
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
        if (!next) {
          setDigits("");
          setPicked(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-w-xs"
        // Physical-keyboard parity with the on-screen keypad: type digits/*/#
        // to enter, Backspace to delete, Enter to call. Enter is skipped when a
        // <button> is focused so the focused control handles it (no double-fire).
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (/^[0-9*#]$/.test(e.key)) {
            e.preventDefault();
            press(e.key);
          } else if (e.key === "Backspace") {
            e.preventDefault();
            backspace();
          } else if (
            e.key === "Enter" &&
            canCall &&
            !(e.target instanceof HTMLButtonElement)
          ) {
            e.preventDefault();
            void call();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("shell.dialANumber")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            // Announce the number as it's entered — a purely visual display left
            // keypad entry silent to screen-reader users.
            aria-live="polite"
            role="status"
            className="min-h-[2.25rem] text-center text-2xl font-medium tabular-nums tracking-wide"
          >
            {digits || (
              <span className="text-app-muted-2">
                {t("shell.enterANumber")}
              </span>
            )}
          </div>

          {/* #459: who this could be, best first. Between the readout and the
              keypad, where every system dialer puts it. */}
          {ranked.length > 0 ? (
            <ul className="-mt-2 space-y-1" aria-label={t("shell.matchingContacts")}>
              {ranked.map((match) => {
                const chosen = picked?.number === match.number;
                return (
                  <li key={`${match.number}-${match.contactId ?? ""}`}>
                    <button
                      type="button"
                      onClick={() => pickMatch(match)}
                      aria-pressed={chosen}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        chosen ? "bg-accent" : ""
                      }`}
                    >
                      <span className="truncate text-sm font-medium text-app-ink">
                        {match.label}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-app-muted-2">
                        {formatPhone(match.number)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            matchedName && (
              <p className="-mt-2 text-center text-sm font-medium text-primary">
                {matchedName}
              </p>
            )
          )}

          {active.length > 1 && (
            <Select value={fromId ?? active[0]?.id} onValueChange={setFromId}>
              <SelectTrigger aria-label={t("shell.callFrom")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {active.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {t("shell.fromNumber", {
                      number: formatPhone(n.number_e164),
                    })}
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
              {t("shell.call")}
            </Button>
            {/* #459: the other verb, and the one a trades crew uses more. It is
                secondary because this screen is the dialer, not because texting
                matters less. */}
            <Button
              variant="outline"
              onClick={message}
              disabled={!canCall}
              aria-label={t("shell.sendMessageInstead")}
            >
              <MessageSquare strokeWidth={1.75} />
              {t("shell.textAction")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={backspace}
              disabled={!digits}
              aria-label={t("shell.deleteLastDigit")}
            >
              <Delete strokeWidth={1.75} />
            </Button>
          </div>

          {/* #459: the two ways out of the keypad. "Add contact" only when the
              number is dialable and unknown, because offering to save somebody
              already on file is an offer that does nothing. */}
          <div className="flex items-center justify-between gap-2 border-t border-app-line pt-3 text-sm">
            <Link
              href="/contacts"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-app-muted-2 transition-colors duration-100 hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Users strokeWidth={1.75} className="size-4" />
              {t("shell.navContacts")}
            </Link>
            {target?.contactId ? (
              <Link
                href={`/contacts/${target.contactId}`}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-primary transition-colors duration-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("shell.openContact")}
              </Link>
            ) : canCall ? (
              <Link
                href={`/contacts?new=${encodeURIComponent(digits)}`}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium text-primary transition-colors duration-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserPlus strokeWidth={1.75} className="size-4" />
                {t("shell.addContact")}
              </Link>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
