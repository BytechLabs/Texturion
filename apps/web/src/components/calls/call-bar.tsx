"use client";

import {
  ArrowRightLeft,
  Grid3x3,
  MessageSquareText,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Play,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CopyablePhoneNumber } from "@/components/ui/copyable-phone-number";
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
import { useSoftphone } from "@/lib/softphone/provider";
import { CALL_SHORTCUTS } from "@/lib/softphone/shortcuts";
import type { CallInfo } from "@/lib/softphone/state";
import { cn } from "@/lib/utils";

const CALL_PHASE = {
  ringing: { icon: PhoneIncoming, label: "shell.incomingCall" },
  connecting: { icon: PhoneOutgoing, label: "shell.calling" },
  active: { icon: Phone, label: "shell.onACall" },
  held: { icon: Pause, label: "shell.onHold" },
  ended: { icon: PhoneOff, label: "shell.callFinished" },
} as const;
const CALL_ROW = "pointer-events-auto flex min-w-0 items-center gap-x-3 gap-y-2";
const END_BUTTON = "bg-[var(--app-call-ring-fill)] text-[var(--app-call-ring-label)] hover:bg-[var(--app-call-ring-fill)]/80 hover:text-[var(--app-call-ring-label)]";

function LiveTimer({ since }: { since: number }) {
  const t = useT();
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
  return <span className="tabular-nums">{formatCallDuration(elapsed, t)}</span>;
}

function CallIdentity({ call }: { call: CallInfo }) {
  const t = useT();
  const { icon: Icon, label } = CALL_PHASE[call.phase];
  const number = call.peer.number ? formatPhone(call.peer.number) : "";
  const name = call.peer.name || number || t("shell.unknownCaller");
  const numberIsName = number && (name === number || name === call.peer.number);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-app-card bg-[var(--call-fill)] text-[var(--call-label)]">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="min-w-0 truncate text-sm font-semibold text-app-ink">
          {numberIsName ? <CopyablePhoneNumber number={call.peer.number} /> : name}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-[var(--call-label)]">
          <span className="call-signal" aria-hidden>
            {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
          </span>
          {t(label)}
        </span>
        {call.phase === "active" && call.activeSince !== null && (
          <span className="text-xs text-app-muted-2"><LiveTimer since={call.activeSince} /></span>
        )}
        {number && !numberIsName && (
          <span className="min-w-0 truncate text-xs text-app-muted-2">
            <CopyablePhoneNumber number={call.peer.number} label={number} />
          </span>
        )}
      </div>
    </div>
  );
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
      className="absolute right-3 top-full z-10 mt-2 max-h-[60svh] w-[min(26rem,calc(100%-1.5rem))] overflow-y-auto rounded-app-card border border-app-line bg-app-paper p-2 shadow-lg"
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
            <div key={target.user_id} className="space-y-2 rounded-md px-2 py-1.5 text-sm">
              <div className="[overflow-wrap:anywhere]">
                <p>{name}</p>
                {target.has_push_channel !== undefined && (
                  <p className="text-xs text-app-muted-2">
                    {target.has_push_channel ? t("shell.transferAlertsAvailable") : t("shell.transferNoAlerts")}
                  </p>
                )}
                {target.busy && <p className="text-xs text-app-muted-2">{t("shell.onACall")}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-8 max-w-full whitespace-normal py-1 [overflow-wrap:anywhere]"
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
                  className="h-auto min-h-8 max-w-full whitespace-normal py-1 [overflow-wrap:anywhere]"
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
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-t border-app-line px-3 py-1.5">
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
  const name = call.peer.name || formatPhone(call.peer.number) || t("shell.unknownCaller");
  const { dismiss } = softphone;

  useEffect(() => {
    if (call.phase !== "ended") return;
    const timer = setTimeout(() => dismiss(call.id), 6000);
    return () => clearTimeout(timer);
  }, [call.phase, call.id, dismiss]);

  return (
    <div
      role={call.phase === "ringing" ? "alert" : undefined}
      data-phase={call.phase}
      className={cn("call-strip", CALL_ROW, "justify-between px-3 py-1.5 sm:px-5", prominent && "py-2")}
    >
      <CallIdentity call={call} />
      {call.phase === "ringing" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("min-h-11 min-w-11 md:min-h-0 md:min-w-0", END_BUTTON)}
            aria-label={t("shell.decline")}
            aria-keyshortcuts={CALL_SHORTCUTS.hangup.keys}
            onClick={() => softphone.hangup(call.id)}
          >
            <PhoneOff className="size-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{t("shell.decline")}</span>
          </Button>
          <Button
            size="sm"
            className="min-h-11 bg-[var(--app-lime)] text-[var(--app-lime-foreground)] hover:bg-[var(--app-lime)]/85 md:min-h-0"
            aria-keyshortcuts={CALL_SHORTCUTS.answer.keys}
            onClick={() =>
              void softphone.answer(call.id).catch((error: unknown) =>
                toast.error(error instanceof Error ? error.message : t("shell.answerFailed")),
              )
            }
          >
            <Phone className="size-4" strokeWidth={1.75} />
            {t("shell.answer")}
          </Button>
        </div>
      )}
      {call.phase === "held" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 md:min-h-0"
            aria-label={t("shell.resumeCall", { name })}
            data-hold-call={call.id}
            onClick={(event) => onToggleHold(event.currentTarget)}
          >
            <Play className="size-4" strokeWidth={1.75} />
            {t("shell.resume")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={END_BUTTON}
            aria-label={t("shell.hangUpHeldCall")}
            onClick={() => softphone.hangup(call.id)}
          >
            <PhoneOff className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      )}
      {call.phase === "ended" && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("shell.dismiss")}
          onClick={() => dismiss(call.id)}
        >
          <X className="size-4" strokeWidth={1.75} />
        </Button>
      )}
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
      className="absolute right-3 top-full z-10 mt-2 w-[min(20rem,calc(100%-1.5rem))] rounded-app-card border border-app-line bg-app-paper p-3 shadow-lg"
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
  const muteLabel = t(call.muted ? "shell.unmute" : "shell.mute");

  return (
    <div
      ref={card}
      data-phase={call.phase}
      className={cn("call-strip", CALL_ROW, "relative flex-wrap px-3 py-2 sm:px-5 xl:flex-nowrap")}
    >
      <CallIdentity call={call} />
      <div className="flex w-full flex-wrap items-center justify-between gap-0.5 border-t border-app-line pt-1.5 sm:w-auto sm:flex-nowrap sm:justify-end sm:border-0 sm:pt-0">
        <Button
          variant="ghost"
          size="icon-sm"
          className="xl:w-auto xl:px-2.5 aria-pressed:bg-[var(--app-call-ring-fill)] aria-pressed:text-[var(--app-call-ring-label)]"
          aria-label={muteLabel}
          aria-keyshortcuts={CALL_SHORTCUTS.mute.keys}
          aria-pressed={call.muted}
          onClick={() => softphone.toggleMute(call.id)}
        >
          {call.muted ? (
            <MicOff className="size-4" strokeWidth={1.75} />
          ) : (
            <Mic className="size-4" strokeWidth={1.75} />
          )}
          <span className="hidden xl:inline">{muteLabel}</span>
        </Button>
        {call.phase === "active" && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="xl:w-auto xl:px-2.5"
            aria-label={t("shell.putOnHold")}
            data-hold-call={call.id}
            onClick={(event) => onToggleHold(event.currentTarget)}
          >
            <Pause className="size-4" strokeWidth={1.75} />
            <span className="hidden xl:inline">{t("shell.hold")}</span>
          </Button>
        )}
        {call.phase === "active" && (
          <Button
            ref={keypadTrigger}
            variant="ghost"
            size="icon-sm"
            className="xl:w-auto xl:px-2.5"
            aria-label={t("shell.keypad")}
            aria-expanded={keypadOpen}
            onClick={() => keypadOpen ? closePanel() : setPanel("keypad")}
          >
            <Grid3x3 className="size-4" strokeWidth={1.75} />
            <span className="hidden xl:inline">{t("shell.keypad")}</span>
          </Button>
        )}
        {keypadOpen && call.phase === "active" && (
          <DtmfKeypad callId={call.id} onClose={closePanel} />
        )}
        {call.phase === "active" &&
          (conversationId ? (
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              aria-label={t("shell.openConversationForNotes")}
              title={t("shell.openConversationForNotes")}
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
            disabled={!call.sessionId || !serverAddressable}
            title={
              call.sessionId && serverAddressable
                ? t("shell.transferThisCall")
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("shell.hangUp")}
          aria-keyshortcuts={CALL_SHORTCUTS.hangup.keys}
          onClick={() => softphone.hangup(call.id)}
          className={cn(END_BUTTON, "sm:w-auto sm:px-3 md:w-auto")}
        >
          <PhoneOff className="size-4" strokeWidth={1.75} />
          <span className="hidden sm:inline">{t("shell.hangUp")}</span>
        </Button>
      </div>
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
    const interaction = new AbortController();
    const play = () => {
      void sound.play().then(() => interaction.abort()).catch(() => {});
    };
    document.addEventListener("click", play, { signal: interaction.signal });
    document.addEventListener("keydown", play, { signal: interaction.signal });
    play();
    return () => {
      interaction.abort();
      sound.pause();
    };
  }, [paused, isPending]);
  return null;
}

export function CallBar() {
  const t = useT();
  const softphone = useSoftphone();
  const region = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const showing = Boolean(softphone?.calls.length);
  useLayoutEffect(() => {
    const bar = region.current;
    const space = slot.current;
    if (!showing || !bar || !space) return;
    // The strip must stay in the body portal so dialogs cannot trap or hide its controls.
    const position = () => {
      const { top, left, width } = space.getBoundingClientRect();
      bar.style.top = `${top}px`;
      bar.style.left = `${left}px`;
      bar.style.width = `${width}px`;
      space.style.height = `${bar.offsetHeight}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(space);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [showing]);
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
    const name = call.peer.name || formatPhone(call.peer.number) || t("shell.unknownCaller");
    if (call.phase === "active") return t("shell.callConnected", { name });
    if (call.phase === "held") return t("shell.callOnHold", { name });
    if (call.phase === "ended") return t("shell.callEnded", { name });
    return "";
  }).filter(Boolean).join(". ");

  const portal = createPortal(
    <div aria-live="polite">
      <div role="status" className="sr-only">{status}</div>
      {ringing && <Ringtone />}
      {calls.length > 0 && (
        <div
          ref={region}
          data-call-bar=""
          className={cn(
            "call-arrive",
            "pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col border-b border-app-line bg-app-paper font-sans",
            "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[var(--call-signal)]",
            "call-strip",
          )}
          data-phase={ringing ? "ringing" : active?.phase ?? others[0]?.phase}
          role="region"
          aria-live="off"
          aria-label={t("shell.navCalls")}
        >
          {active && (
            <ActiveCard
              key={active.id}
              call={active}
              onToggleHold={(button) => holdWithFocus(active.id, button)}
            />
          )}
          <ConsultControls />
          {others.length > 0 && (
            <div className="max-h-[38svh] divide-y divide-app-line overflow-y-auto [&:not(:first-child)]:border-t [&:not(:first-child)]:border-app-line">
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
        </div>
      )}
    </div>,
    document.body,
  );
  return (
    <>
      {showing && <div ref={slot} className="shrink-0" aria-hidden />}
      {portal}
    </>
  );
}
