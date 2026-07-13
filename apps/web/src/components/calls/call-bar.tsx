"use client";

/**
 * D43 (#135) call bar — the persistent in-app call surface, phase 3:
 * multi-call. Renders the ACTIVE call's controls (mute, hold, transfer,
 * hang up, open-conversation) plus a compact chip per OTHER call — a held
 * call to flip back to, an incoming ring to answer (answering holds the
 * current call: call waiting), or a brief "Call ended". Absent entirely at
 * rest so it never occupies space.
 *
 * Fixed above the mobile tab bar; a slim floating card on desktop.
 */
import {
  ArrowRightLeft,
  Grid3x3,
  MessageSquareText,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  useLiveCall,
  useTransferCall,
  useTransferTargets,
} from "@/lib/api/calls";
import { useMembers } from "@/lib/api/team";
import { ApiError } from "@/lib/api/error";
import { formatCallDuration } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { useSoftphone } from "@/lib/softphone/provider";
import type { CallInfo } from "@/lib/softphone/state";
import { cn } from "@/lib/utils";

function LiveTimer({ since }: { since: number }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - since) / 1000)),
  );
  useEffect(() => {
    const id = window.setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [since]);
  return <span className="tabular-nums">{formatCallDuration(elapsed)}</span>;
}

/** The transfer picker: teammates who can take this call, busy flags honest. */
function TransferMenu({
  sessionId,
  onDone,
}: {
  sessionId: string;
  onDone: () => void;
}) {
  const targets = useTransferTargets(sessionId, true);
  const members = useMembers();
  const transfer = useTransferCall();

  const nameOf = (userId: string) =>
    members.data?.data.find((m) => m.user_id === userId)?.display_name ??
    "Teammate";

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-app-card border border-app-line bg-app-white p-2 shadow-lg">
      <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        Transfer to
      </p>
      {targets.isPending ? (
        <p className="px-2 py-1.5 text-sm text-app-muted-2">Loading…</p>
      ) : (targets.data?.targets.length ?? 0) === 0 ? (
        <p className="px-2 py-1.5 text-sm text-app-muted-2">
          Nobody else has their phone open right now.
        </p>
      ) : (
        targets.data!.targets.map((target) => (
          <button
            key={target.user_id}
            type="button"
            disabled={transfer.isPending}
            onClick={() =>
              transfer.mutate(
                { sessionId, targetUserId: target.user_id },
                {
                  onSuccess: () => {
                    toast.success(
                      `Transferring to ${nameOf(target.user_id)}…`,
                    );
                    onDone();
                  },
                  onError: (cause) =>
                    toast.error(
                      cause instanceof ApiError
                        ? cause.message
                        : "Couldn't transfer. Try again.",
                    ),
                },
              )
            }
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-app-ink transition-colors duration-150 hover:bg-app-stone-1 disabled:opacity-50"
          >
            <span className="truncate">{nameOf(target.user_id)}</span>
            {target.busy && (
              <span className="ml-2 shrink-0 text-[11px] text-app-muted-2">
                On a call
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}

/** A compact chip for a NON-active call (held / ringing / ended). */
function CallChip({ call }: { call: CallInfo }) {
  const softphone = useSoftphone()!;
  const label = call.peer.name || formatPhone(call.peer.number);
  if (call.phase === "ringing") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-primary/40 bg-app-white px-3 py-1.5 shadow-lg">
        <span aria-hidden className="size-2 rounded-full bg-primary animate-pulse" />
        <span className="max-w-[140px] truncate text-[12.5px] font-medium">
          {label}
        </span>
        <Button size="sm" className="h-6 gap-1 px-2 text-[12px]" onClick={() => softphone.answer(call.id)}>
          <Phone className="size-3" strokeWidth={1.75} />
          Answer
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-app-clay hover:bg-app-clay/10"
          aria-label="Decline"
          onClick={() => softphone.hangup(call.id)}
        >
          <PhoneOff className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }
  if (call.phase === "held") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-app-line bg-app-white px-3 py-1.5 shadow-lg">
        <Pause className="size-3 text-app-muted-2" strokeWidth={1.75} aria-hidden />
        <span className="max-w-[140px] truncate text-[12.5px] text-app-muted">
          {label} · on hold
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label={`Resume call with ${label}`}
          onClick={() => softphone.toggleHold(call.id)}
        >
          <Play className="size-3.5" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-app-clay hover:bg-app-clay/10"
          aria-label="Hang up held call"
          onClick={() => softphone.hangup(call.id)}
        >
          <PhoneOff className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }
  if (call.phase === "ended") {
    return (
      <div className="flex items-center gap-2 rounded-full border border-app-line bg-app-white px-3 py-1.5 text-app-muted-2 shadow-lg">
        <span className="max-w-[140px] truncate text-[12.5px]">
          {label} · ended
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label="Dismiss"
          onClick={() => softphone.dismiss(call.id)}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }
  // 'connecting' chips only exist while another call is active (rare).
  return (
    <div className="flex items-center gap-2 rounded-full border border-app-line bg-app-white px-3 py-1.5 shadow-lg">
      <span aria-hidden className="size-2 rounded-full bg-warning animate-pulse" />
      <span className="max-w-[140px] truncate text-[12.5px]">{label}…</span>
    </div>
  );
}

const DTMF_KEYS = [
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

/** An in-call keypad — sends DTMF touch-tones to navigate phone menus / IVRs
 *  ("press 1 for sales…") when calling a supplier or utility. */
function DtmfKeypad({
  callId,
  onClose,
}: {
  callId: string;
  onClose: () => void;
}) {
  const softphone = useSoftphone()!;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-app-card border border-app-line bg-app-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
          Keypad
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close keypad"
          className="text-app-muted-2 transition-colors hover:text-app-ink"
        >
          <X className="size-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {DTMF_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => softphone.sendDtmf(callId, key)}
            className="rounded-lg border border-app-line py-2.5 text-base font-medium text-app-ink transition-colors duration-100 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The active call's full control card. */
function ActiveCard({ call }: { call: CallInfo }) {
  const softphone = useSoftphone()!;
  const [transferOpen, setTransferOpen] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const live = useLiveCall(call.sessionId);
  const name = call.peer.name || formatPhone(call.peer.number);
  const number = call.peer.number ? formatPhone(call.peer.number) : "";

  return (
    <div className="relative flex w-full max-w-lg items-center gap-2.5 rounded-app-card border border-primary/20 bg-app-white px-4 py-2.5 shadow-lg">
      {transferOpen && call.sessionId && (
        <TransferMenu
          sessionId={call.sessionId}
          onDone={() => setTransferOpen(false)}
        />
      )}
      {keypadOpen && call.phase === "active" && (
        <DtmfKeypad callId={call.id} onClose={() => setKeypadOpen(false)} />
      )}
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          call.phase === "active"
            ? "bg-primary animate-pulse"
            : "bg-warning animate-pulse",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-app-ink">{name}</p>
        <p className="truncate text-xs text-app-muted-2">
          {call.phase === "connecting" ? (
            "Calling…"
          ) : call.activeSince !== null ? (
            <LiveTimer since={call.activeSince} />
          ) : (
            ""
          )}
          {number ? ` · ${number}` : ""}
        </p>
      </div>

      {/* In-call notes: the conversation IS the notepad (threaded at answer). */}
      {live.data?.conversation_id && (
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          aria-label="Open the conversation to take notes"
        >
          <Link href={`/inbox/${live.data.conversation_id}`}>
            <MessageSquareText className="size-4" strokeWidth={1.75} />
          </Link>
        </Button>
      )}
      {call.phase === "active" && call.sessionId && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Transfer this call"
          aria-expanded={transferOpen}
          onClick={() => setTransferOpen((open) => !open)}
        >
          <ArrowRightLeft className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      {call.phase === "active" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Keypad"
          aria-expanded={keypadOpen}
          onClick={() => setKeypadOpen((open) => !open)}
        >
          <Grid3x3 className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      {call.phase === "active" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Put on hold"
          onClick={() => softphone.toggleHold(call.id)}
        >
          <Pause className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={call.muted ? "Unmute" : "Mute"}
        aria-pressed={call.muted}
        onClick={() => softphone.toggleMute(call.id)}
      >
        {call.muted ? (
          <MicOff className="size-4 text-app-clay" strokeWidth={1.75} />
        ) : (
          <Mic className="size-4" strokeWidth={1.75} />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Hang up"
        onClick={() => softphone.hangup(call.id)}
        className="text-app-clay hover:bg-app-clay/10"
      >
        <PhoneOff className="size-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}

export function CallBar() {
  const softphone = useSoftphone();
  if (!softphone || softphone.calls.length === 0) return null;

  const active =
    softphone.calls.find((c) => c.id === softphone.activeId) ??
    softphone.calls.find((c) => c.phase === "connecting") ??
    null;
  const others = softphone.calls.filter((c) => c.id !== active?.id);
  // A lone ringing call renders as the prominent chip row (no active card).

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-3",
        // Sit above the mobile tab bar; float near the bottom on desktop.
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-4",
      )}
      role="region"
      aria-label="Calls"
    >
      {others.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {others.map((call) => (
            <CallChip key={call.id} call={call} />
          ))}
        </div>
      )}
      {active && <ActiveCard call={active} />}
    </div>
  );
}
