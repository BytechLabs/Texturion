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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SECTION_LABEL_CLASS } from "@/components/ui/section-label";
import { useT } from "@/i18n/provider";
import {
  LIVE_NOTE_LOOKUP_ATTEMPTS,
  LIVE_NOTE_LOOKUP_INTERVAL_MS,
  useLiveCall,
  useTransferCall,
  useTransferTargets,
} from "@/lib/api/calls";
import { useMembers } from "@/lib/api/team";
import { useNotificationsUnreadCount } from "@/lib/api/notifications";
import { ApiError } from "@/lib/api/error";
import { formatCallDuration } from "@/lib/format/call";
import { formatPhone } from "@/lib/format/phone";
import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
import { useSoftphone } from "@/lib/softphone/provider";
import { CALL_SHORTCUTS } from "@/lib/softphone/shortcuts";
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
  const t = useT();
  const targets = useTransferTargets(sessionId, true);
  const members = useMembers();
  const transfer = useTransferCall();
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => panel.current?.focus(), []);
  const softphone = useSoftphone();
  const [startingConsult, setStartingConsult] = useState(false);

  const nameOf = (userId: string) =>
    members.data?.data.find((m) => m.user_id === userId)?.display_name ??
    t("shell.teammate");
  async function consult(targetId: string, name: string) {
    if (!softphone) return;
    setStartingConsult(true);
    try {
      await softphone.startConsult(sessionId, targetId, name);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.consultUnavailable"));
    } finally {
      setStartingConsult(false);
    }
  }

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="group"
      aria-label={t("shell.transferTo")}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-app-card border border-app-line bg-app-paper p-2 shadow-lg"
    >
      <p className={cn(SECTION_LABEL_CLASS, "px-2 pb-1.5")}>
        {t("shell.transferTo")}
      </p>
      {targets.isPending ? (
        <p className="px-2 py-1.5 text-sm text-app-muted-2">
          {t("shell.loading")}
        </p>
      ) : ((targets.data?.targets.length ?? 0) === 0 ? (
        <p className="px-2 py-1.5 text-sm text-app-muted-2">
          {t("shell.noTransferTargets")}
        </p>
      ) : (
        targets.data!.targets.map((target) => {
          const name = nameOf(target.user_id);
          const disabled = target.busy || transfer.isPending || startingConsult;
          return (
            <div key={target.user_id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm">
              <div className="min-w-0">
                <p className="truncate">{name}</p>
                {target.has_push_channel !== undefined && (
                  <p className="text-xs text-app-muted-2">
                    {target.has_push_channel ? t("shell.transferAlertsAvailable") : t("shell.transferNoAlerts")}
                  </p>
                )}
                {target.busy && <p className="text-xs text-app-muted-2">{t("shell.onACall")}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("shell.transferToTeammate", { name })}
                  disabled={disabled}
                  onClick={() => transfer.mutate({ sessionId, targetUserId: target.user_id }, {
                    onSuccess: () => {
                      toast.success(t("shell.transferring", { name }));
                      onDone();
                    },
                    onError: (cause) => toast.error(cause instanceof ApiError ? cause.message : t("shell.transferFailed")),
                  })}
                >
                  {t("shell.transfer")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("shell.talkFirstWith", { name })}
                  disabled={!softphone || disabled}
                  onClick={() => void consult(target.user_id, name)}
                >
                  {t("shell.talkFirst")}
                </Button>
              </div>
            </div>
          );
        })
      ))}
    </div>
  );
}

function ConsultControls() {
  const t = useT();
  const softphone = useSoftphone();
  const [pending, setPending] = useState(false);
  const consult = softphone?.consultation;
  if (!softphone || !consult) return null;
  const senderConnected = softphone.calls.some((call) => call.id === consult.senderLegId && call.phase === "active");
  async function run(action: "complete" | "cancel") {
    setPending(true);
    try {
      await softphone?.endConsult(action);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("shell.consultUnavailable"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-app-card border border-app-line bg-app-paper p-2 shadow-lg">
      <span className="px-2 text-sm">{t("shell.consultingWith", { name: consult.targetName })}</span>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void run("cancel")}>
        {t("shell.backToCaller")}
      </Button>
      <Button type="button" size="sm" disabled={pending || !senderConnected} onClick={() => void run("complete")}>
        {t("shell.handOver")}
      </Button>
    </div>
  );
}

/** A compact chip for a NON-active call (held / ringing / ended). */
function CallChip({
  call,
  prominent,
  onToggleHold,
}: {
  call: CallInfo;
  prominent: boolean;
  onToggleHold: (button: HTMLButtonElement) => void;
}) {
  const t = useT();
  const softphone = useSoftphone()!;
  const label = call.peer.name || formatPhone(call.peer.number);
  const labelIsNumber = call.peer.number && (!call.peer.name || call.peer.name === formatPhone(call.peer.number));
  // The "ended" chip is meant to be brief — auto-dismiss it after a few seconds
  // (the manual X still works) so a stale "· ended" pill doesn't linger for the
  // rest of the session.
  useEffect(() => {
    if (call.phase !== "ended") return;
    const timer = setTimeout(() => softphone.dismiss(call.id), 6000);
    return () => clearTimeout(timer);
  }, [call.phase, call.id, softphone]);
  if (call.phase === "ringing") {
    return (
      <div
        role="alert"
        className={cn(
          "pointer-events-auto flex items-center gap-2 border border-primary/40 bg-app-paper shadow-lg",
          prominent ? "rounded-app-card px-4 py-2.5" : "rounded-full px-3 py-1.5",
        )}
      >
        <span aria-hidden className="size-2 rounded-full bg-primary animate-pulse" />
        <span className={cn("max-w-[140px] truncate font-medium", prominent ? "text-[15px]" : "text-[12.5px]")}>
          <span className="sr-only">{t("shell.incomingCallFrom")} </span>
          {labelIsNumber ? <CopyablePhoneNumber number={call.peer.number} /> : label}
        </span>
        <Button
          size="sm"
          className={cn(
            "min-h-11 min-w-11 md:min-h-0 md:min-w-0",
            !prominent && "gap-1 px-2 text-[12px] md:h-6",
          )}
          aria-keyshortcuts={CALL_SHORTCUTS.answer.keys}
          onClick={() =>
            void softphone.answer(call.id).catch((error: unknown) =>
              toast.error(
                error instanceof Error
                  ? error.message
                  : t("shell.answerFailed"),
              ),
            )
          }
        >
          <Phone className="size-3" strokeWidth={1.75} />
          {t("shell.answer")}
        </Button>
        <Button
          variant="ghost"
          size={prominent ? "sm" : "icon-sm"}
          className={cn(
            "min-h-11 min-w-11 text-destructive hover:bg-destructive/10 md:min-h-0 md:min-w-0",
            !prominent && "md:size-6",
          )}
          aria-label={t("shell.decline")}
          aria-keyshortcuts={CALL_SHORTCUTS.hangup.keys}
          onClick={() => softphone.hangup(call.id)}
        >
          <PhoneOff className="size-3.5" strokeWidth={1.75} />
          {prominent && t("shell.decline")}
        </Button>
      </div>
    );
  }
  if (call.phase === "held") {
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-app-line bg-app-paper px-3 py-1.5 shadow-lg">
        <Pause className="size-3 text-app-muted-2" strokeWidth={1.75} aria-hidden />
        <span className="max-w-[140px] truncate text-[12.5px] text-app-muted">
          {t("shell.callOnHold", { name: label })}
        </span>
        {labelIsNumber && <CopyablePhoneNumber number={call.peer.number} iconOnly />}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label={t("shell.resumeCall", { name: label })}
          data-hold-call={call.id}
          onClick={(event) => onToggleHold(event.currentTarget)}
        >
          <Play className="size-3.5" strokeWidth={1.75} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 text-app-clay hover:bg-app-clay/10"
          aria-label={t("shell.hangUpHeldCall")}
          onClick={() => softphone.hangup(call.id)}
        >
          <PhoneOff className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }
  if (call.phase === "ended") {
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-app-line bg-app-paper px-3 py-1.5 text-app-muted-2 shadow-lg">
        <span className="max-w-[140px] truncate text-[12.5px]">
          {t("shell.callEnded", { name: label })}
        </span>
        {labelIsNumber && <CopyablePhoneNumber number={call.peer.number} iconOnly />}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label={t("shell.dismiss")}
          onClick={() => softphone.dismiss(call.id)}
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    );
  }
  // 'connecting' chips only exist while another call is active (rare).
  return (
    <div className="flex items-center gap-2 rounded-full border border-app-line bg-app-paper px-3 py-1.5 shadow-lg">
      <span aria-hidden className="size-2 rounded-full bg-warning animate-pulse" />
      <span className="max-w-[140px] truncate text-[12.5px]">{label}…</span>
      {labelIsNumber && <CopyablePhoneNumber number={call.peer.number} iconOnly />}
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
  const t = useT();
  const softphone = useSoftphone()!;
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => panel.current?.focus(), []);
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="group"
      aria-label={t("shell.keypad")}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-app-card border border-app-line bg-app-paper p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className={SECTION_LABEL_CLASS}>
          {t("shell.keypad")}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t("shell.closeKeypad")}
          className="text-app-muted-2 transition-colors hover:text-app-ink"
        >
          <X className="size-3.5" strokeWidth={2} />
        </Button>
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
function ActiveCard({
  call,
  onToggleHold,
}: {
  call: CallInfo;
  onToggleHold: (button: HTMLButtonElement) => void;
}) {
  const t = useT();
  const softphone = useSoftphone()!;
  const [panel, setPanel] = useState<"transfer" | "keypad" | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const transferTrigger = useRef<HTMLButtonElement>(null);
  const keypadTrigger = useRef<HTMLButtonElement>(null);
  const transferOpen = panel === "transfer";
  const keypadOpen = panel === "keypad";
  const closePanel = useCallback(() => {
    setPanel(null);
    (panel === "transfer" ? transferTrigger : keypadTrigger).current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!panel) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        !(event.target instanceof Node) ||
        !card.current?.contains(event.target)
      ) return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [closePanel, panel]);
  const live = useLiveCall(call.sessionId);
  const name = call.peer.name || formatPhone(call.peer.number);
  const number = call.peer.number ? formatPhone(call.peer.number) : "";
  // #211 (C1): light transfer/consult on a serverAddressable signal (a
  // SUCCESSFUL GET /v1/calls/live/:session read), not on mere sessionId
  // presence. A 4-part outbound call that fell to the legacy webhook path
  // (kill switch or a pre-#211 worker rollback) still carries a sessionId but
  // has no DO to address, so /live 404s and no dead transfer button appears.
  const serverAddressable = live.isSuccess;
  const conversationId = live.data?.conversation_id ?? null;
  // #516: mirrors Android's `noteLinkGaveUp`. The query stops polling after its
  // window; without this the button would go on saying "Finding…" forever,
  // which is the same lie as the missing button with more patience.
  const [noteLookupGaveUp, setNoteLookupGaveUp] = useState(false);
  useEffect(() => {
    setNoteLookupGaveUp(false);
    if (call.sessionId === null) return;
    const timer = setTimeout(
      () => setNoteLookupGaveUp(true),
      LIVE_NOTE_LOOKUP_ATTEMPTS * LIVE_NOTE_LOOKUP_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
    // Re-armed per session: a transfer lands a NEW session on the same chip,
    // and that call's lookup deserves its own window rather than inheriting a
    // give-up from the leg before it.
  }, [call.sessionId]);
  const noteLinkPending =
    conversationId === null && !noteLookupGaveUp && !live.isError;

  return (
    <div
      ref={card}
      className="pointer-events-auto relative flex w-full max-w-lg items-center gap-2.5 rounded-app-card border border-primary/20 bg-app-paper px-4 py-2.5 shadow-lg"
    >
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
            t("shell.calling")
          ) : (call.activeSince === null ? (
            ""
          ) : (
            <LiveTimer since={call.activeSince} />
          ))}
          {number && (
            <>
              {" · "}
              <CopyablePhoneNumber number={call.peer.number} label={number} />
            </>
          )}
        </p>
      </div>

      {/* In-call notes: the conversation IS the notepad (threaded at answer).
          #516: PRESENT while the call is active, enabled once the thread is
          known. It used to be absent until then, which on a transferred call
          could be forever — and an absent control is indistinguishable from a
          feature that does not exist, so the founder found hold/unhold before
          they found the button. Both phones already keep it mounted and
          disabled (InCallScreen.kt #202, InCallView.swift); this is the web
          client catching up. */}
      {call.phase === "active" &&
        (conversationId ? (
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            aria-label={t("shell.openConversationForNotes")}
          >
            <Link href={`/inbox/${conversationId}`}>
              <MessageSquareText className="size-4" strokeWidth={1.75} />
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            // Says WHICH of the two it is. "Not available" on a call that is
            // still threading reads as broken; "Finding…" on one that already
            // gave up is a lie the user waits on.
            aria-label={
              noteLinkPending
                ? t("shell.findingConversation")
                : t("shell.noConversationForCallAria")
            }
            title={
              noteLinkPending
                ? t("shell.findingConversation")
                : t("shell.noConversationForCall")
            }
          >
            <MessageSquareText className="size-4" strokeWidth={1.75} />
          </Button>
        ))}
      {call.phase === "active" && !softphone.consultation && (
        <Button
          ref={transferTrigger}
          variant="ghost"
          size="icon-sm"
          aria-label={t("shell.transferThisCall")}
          aria-expanded={transferOpen}
          // #516: mounted for the whole active call, enabled once the server
          // can address the session. Disabled still communicates "this call can
          // be transferred, just not this instant"; absent communicates nothing.
          disabled={!call.sessionId || !serverAddressable}
          title={
            call.sessionId && serverAddressable
              ? undefined
              : t("shell.connectingCallToServer")
          }
          onClick={() => transferOpen ? closePanel() : setPanel("transfer")}
        >
          <ArrowRightLeft className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      {transferOpen && call.phase === "active" && call.sessionId && serverAddressable && !softphone.consultation && (
        <TransferMenu sessionId={call.sessionId} onDone={closePanel} />
      )}
      {call.phase === "active" && (
        <Button
          ref={keypadTrigger}
          variant="ghost"
          size="icon-sm"
          aria-label={t("shell.keypad")}
          aria-expanded={keypadOpen}
          onClick={() => keypadOpen ? closePanel() : setPanel("keypad")}
        >
          <Grid3x3 className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      {keypadOpen && call.phase === "active" && (
        <DtmfKeypad callId={call.id} onClose={closePanel} />
      )}
      {call.phase === "active" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("shell.putOnHold")}
          data-hold-call={call.id}
          onClick={(event) => onToggleHold(event.currentTarget)}
        >
          <Pause className="size-4" strokeWidth={1.75} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={call.muted ? t("shell.unmute") : t("shell.mute")}
        aria-keyshortcuts={CALL_SHORTCUTS.mute.keys}
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
        aria-label={t("shell.hangUp")}
        aria-keyshortcuts={CALL_SHORTCUTS.hangup.keys}
        onClick={() => softphone.hangup(call.id)}
        className="text-app-clay hover:bg-app-clay/10"
      >
        <PhoneOff className="size-4" strokeWidth={1.75} />
      </Button>
    </div>
  );
}

function Ringtone() {
  const { data, isPending } = useNotificationsUnreadCount();
  const paused = data?.alert_pause?.push_paused ?? false;
  useEffect(() => {
    if (paused || isPending) return;
    const sound = new Audio("/incoming-call.mp3");
    sound.loop = true;
    void sound.play().catch(() => {});
    return () => sound.pause();
  }, [paused, isPending]);
  return null;
}

export function CallBar() {
  const t = useT();
  const softphone = useSoftphone();
  const region = useRef<HTMLDivElement>(null);
  const holdFocus = useRef<{ id: string; previous: HTMLButtonElement } | null>(null);
  useEffect(() => {
    // Radix's document-level focus trap would pull focus back from the call controls.
    function keepCallFocus(event: FocusEvent) {
      const next = event.type === "focusout" ? event.relatedTarget : event.target;
      if (next instanceof Node && region.current?.contains(next)) event.stopPropagation();
    }
    document.body.addEventListener("focusin", keepCallFocus);
    document.body.addEventListener("focusout", keepCallFocus);
    return () => {
      document.body.removeEventListener("focusin", keepCallFocus);
      document.body.removeEventListener("focusout", keepCallFocus);
    };
  }, []);
  useLayoutEffect(() => {
    const request = holdFocus.current;
    if (!request || request.previous.isConnected) return;
    holdFocus.current = null;
    if (document.activeElement !== document.body) return;
    const buttons = region.current?.querySelectorAll<HTMLButtonElement>("[data-hold-call]");
    if (!buttons) return;
    Array.from(buttons).find((button) => button.dataset.holdCall === request.id)?.focus();
  });
  if (typeof document === "undefined" || !softphone) return null;

  const { calls, activeId, toggleHold } = softphone;
  function holdWithFocus(callId: string, button: HTMLButtonElement) {
    holdFocus.current = document.activeElement === button ? { id: callId, previous: button } : null;
    toggleHold(callId);
  }

  const active =
    calls.find((c) => c.id === activeId) ??
    calls.find((c) => c.phase === "connecting") ??
    null;
  const others = calls.filter((call) =>
    call.id !== active?.id && call.id !== softphone.consultation?.originalCallId,
  );
  const ringing = others.some((call) => call.phase === "ringing");
  const status = calls.map((call) => {
    const name = call.peer.name || formatPhone(call.peer.number);
    if (call.phase === "active") return t("shell.callConnected", { name });
    if (call.phase === "held") return t("shell.callOnHold", { name });
    if (call.phase === "ended") return t("shell.callEnded", { name });
    return "";
  }).filter(Boolean).join(". ");

  return createPortal(
    <div aria-live="polite">
      <div role="status" className="sr-only">{status}</div>
      {ringing && <Ringtone />}
      {calls.length > 0 && (
        <div
          ref={region}
          data-call-bar=""
          className="pointer-events-none fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-[60] flex flex-col items-center gap-2 px-3 font-sans lg:bottom-4"
          role="region"
          aria-live="off"
          aria-label={t("shell.navCalls")}
        >
          <ConsultControls />
          {others.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {others.map((call) => (
                <CallChip
                  key={call.id}
                  call={call}
                  prominent={calls.length === 1}
                  onToggleHold={(button) => holdWithFocus(call.id, button)}
                />
              ))}
            </div>
          )}
          {active && (
            <ActiveCard
              key={active.id}
              call={active}
              onToggleHold={(button) => holdWithFocus(active.id, button)}
            />
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
