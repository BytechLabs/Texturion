"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, PhoneOutgoing, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings/section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import {
  formatDuration,
  MAX_GREETING_MS,
  useDeleteGreeting,
  useGreetingCaptureCall,
  useRecordGreeting,
  useVoicemailGreetings,
} from "@/lib/api/voicemail-greetings";

/**
 * #309 — "Your own voice".
 *
 * A two-person outfit competing with a franchise sells on being a real, local,
 * reachable person. Then nobody answers, and the product hands the caller a
 * synthetic voice reading a company name — which in 2026 is what a spam call
 * sounds like. This card lets them record the greeting themselves.
 *
 * Design notes, and the principles behind them:
 *
 * - **You cannot save a recording you have not heard.** The Save button does
 *   not exist until there is a take, and the player sits directly above it.
 *   Recording your own voice is the one thing people redo — a flow that saves
 *   the first take unheard is a flow that assumes it was good. *Applying:
 *   Ethical Friction, on the step whose result is embarrassing to get wrong.*
 *
 * - **The name is pre-filled.** "After hours" is what most owners are
 *   recording, and an empty required field between them and the save is
 *   friction with no purpose. *Applying: Smart Defaults — never an empty form.*
 *
 * - **The card states what a caller hears TODAY**, before any of this. A
 *   screen full of controls that never says the current state cannot tell an
 *   owner whether they have already done this.
 *
 * - **Deleting confirms.** It changes what every caller to a line using it
 *   hears, and the effect is invisible from this screen. *Applying: Ethical
 *   Friction.*
 *
 * - **There is a second way in, and it is a phone call.** Some owners will
 *   never record in a browser — the mic permission, the laptop held at arm's
 *   length. "Have us call you" rings their phone and they talk. It lives behind
 *   a link rather than beside the record button, because two equally-weighted
 *   ways to do one thing is a decision nobody asked for — and it is promoted to
 *   the front the moment the microphone fails, which is exactly when it is the
 *   answer. *Applying: Zen of Clarity, and Prioritize Intent.*
 *
 * - **Icons from Lucide**, never emoji.
 */
export function VoiceGreetingCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  /**
   * What most owners are recording, so the field is never empty.
   *
   * It is still editable — a workspace with a holiday greeting and a truck
   * greeting needs to say which is which — but nobody should have to think of
   * a name before they can hear their first take.
   */
  const defaultName = t("settingsMore.greetingDefaultName");
  const [capture, setCapture] = useState<CaptureState | null>(null);
  // Polled ONLY while a capture call is out. The owner is on the phone and away
  // from this screen; the greeting appearing in the list below is the only
  // confirmation the call could produce, so it has to arrive on its own.
  const greetings = useVoicemailGreetings(true, capture?.phase === "calling" ? 5_000 : false);
  const record = useRecordGreeting();
  const remove = useDeleteGreeting();
  const captureCall = useGreetingCaptureCall();

  const [take, setTake] = useState<{ blob: Blob; url: string; ms: number } | null>(
    null,
  );
  const [name, setName] = useState(defaultName);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  // The object URL is a handle on browser memory, not a value — drop it when
  // the take is replaced or the card unmounts.
  useEffect(() => {
    return () => {
      if (take) URL.revokeObjectURL(take.url);
    };
  }, [take]);

  async function start() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType });
        setTake({
          blob,
          url: URL.createObjectURL(blob),
          ms: Date.now() - startedAt.current,
        });
        setRecording(false);
      };
      startedAt.current = Date.now();
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      // The overwhelmingly common cause is a denied prompt, and the fix is not
      // in this app — so say where it is rather than "recording failed".
      setMicError(t("settingsMore.greetingMicDenied"));
    }
  }

  function stop() {
    recorder.current?.stop();
  }

  function discard() {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
  }

  async function save() {
    if (!take) return;
    if (take.ms > MAX_GREETING_MS) {
      toast.error(t("settingsMore.greetingTooLong"));
      return;
    }
    try {
      await record.mutateAsync({ name: name.trim(), blob: take.blob, durationMs: take.ms });
      discard();
      setName(defaultName);
      toast.success(t("settingsMore.greetingSaved"));
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.saveFailedGeneric"),
      );
    }
  }

  /**
   * A greeting can be what every caller to a line hears, and this card cannot
   * show which lines use it — so this pause is the only warning there is.
   *
   * A dialog rather than `window.confirm`, matching how releasing a number
   * already asks. One learned pattern for "this is irreversible", not two.
   */
  async function runDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await remove.mutateAsync(target.id);
      toast.success(t("settingsMore.greetingDeleted"));
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.greetingDeleteFailed"),
      );
    }
  }

  // Memoised because the arrival effect below depends on it: a fresh `[]` on
  // every render would re-run that effect forever.
  const rows = useMemo(() => greetings.data?.data ?? [], [greetings.data]);

  /**
   * The greeting landing in the list IS the end of the phone flow.
   *
   * Watched by NAME rather than by count, because a second person recording at
   * the same moment would move a count and mean nothing about this call.
   */
  useEffect(() => {
    if (capture?.phase !== "calling") return;
    if (!rows.some((row) => row.name === capture.name)) return;
    setCapture(null);
    toast.success(
      t("settingsMore.greetingNamedSaved", { name: capture.name }),
    );
  }, [capture, rows, t]);

  async function startCaptureCall() {
    if (!capture || capture.phase === "calling") return;
    try {
      await captureCall.mutateAsync({ name: capture.name.trim(), to: capture.to });
      setCapture({ ...capture, phase: "calling" });
    } catch (cause) {
      toast.error(
        cause instanceof ApiError
          ? cause.message
          : t("settingsMore.greetingCallFailed"),
      );
    }
  }

  return (
    <SettingsCard
      title={t("settingsMore.greetingTitle")}
      description={t("settingsMore.greetingDescription")}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {rows.length === 0
            ? t("settingsMore.greetingNoneYet")
            : t("settingsMore.greetingPickOne")}
        </p>

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-2 last:border-b-0 last:pb-0"
              >
                <span className="min-w-[9rem] text-sm">{row.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDuration(row.duration_ms)}
                </span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-auto px-1.5 py-0.5"
                    aria-label={t("settingsMore.greetingDeleteAria", {
                      name: row.name,
                    })}
                    disabled={remove.isPending}
                    onClick={() => setPendingDelete({ id: row.id, name: row.name })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-md border p-3">
            {take ? (
              <>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">
                    {t("settingsMore.greetingHearItBack")}
                  </p>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the
                      audio IS the content; a caption would be a transcript of
                      the owner's own recording, which they just spoke. */}
                  <audio src={take.url} controls className="w-full" />
                  <p className="text-[12px] text-app-muted-2">
                    {t("settingsMore.greetingTakeLength", {
                      length: formatDuration(take.ms),
                    })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="greeting-name">
                    {t("settingsMore.greetingNameIt")}
                  </Label>
                  <Input
                    id="greeting-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={discard} disabled={record.isPending}>
                    {t("settingsMore.greetingRecordAgain")}
                  </Button>
                  <Button
                    onClick={() => void save()}
                    disabled={record.isPending || name.trim().length === 0}
                  >
                    {record.isPending
                      ? t("common.saving")
                      : t("settingsMore.greetingSaveAction")}
                  </Button>
                </div>
              </>
            ) : recording ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {t("settingsMore.greetingRecordingNow")}
                </span>
                <Button onClick={stop} variant="destructive">
                  <Square className="mr-1.5 size-4" />
                  {t("settingsMore.greetingStop")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {t("settingsMore.greetingUpToTwoMinutes")}
                </span>
                <Button onClick={() => void start()}>
                  <Mic className="mr-1.5 size-4" />
                  {t("settingsMore.greetingRecord")}
                </Button>
              </div>
            )}
            {micError && (
              <p role="alert" className="text-sm text-destructive">
                {micError}
              </p>
            )}
            {!take && !recording && (
              <Button
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() =>
                  setCapture({ phase: "form", name: defaultName, to: "" })
                }
              >
                <PhoneOutgoing className="mr-1.5 size-4" />
                {micError
                  ? t("settingsMore.greetingCallMeInstead")
                  : t("settingsMore.greetingRatherPhone")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* The phone path. One dialog, two states — asking, then waiting — so the
          owner who put the laptop down comes back to the same window that told
          them what to do. */}
      <Dialog
        open={capture !== null}
        onOpenChange={(next) => {
          if (!next) setCapture(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {capture?.phase === "calling" ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("settingsMore.greetingCallingNow", {
                    number: capture.to,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("settingsMore.greetingAnswerAndListen")}
                </DialogDescription>
              </DialogHeader>
              <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
                <li>{t("settingsMore.greetingStepBeep")}</li>
                <li>{t("settingsMore.greetingStepSpeak")}</li>
                <li>{t("settingsMore.greetingStepHangUp")}</li>
              </ol>
              <p className="text-[12px] text-app-muted-2">
                {t("settingsMore.greetingWillAppear", {
                  name: capture.name,
                })}
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCapture(null)}>
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t("settingsMore.greetingPhoneTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("settingsMore.greetingPhoneBody")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="capture-to">
                    {t("settingsMore.greetingYourNumber")}
                  </Label>
                  <Input
                    id="capture-to"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="(613) 555-0199"
                    value={capture?.to ?? ""}
                    onChange={(event) =>
                      setCapture((prev) =>
                        prev ? { ...prev, to: event.target.value } : prev,
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="capture-name">
                    {t("settingsMore.greetingNameIt")}
                  </Label>
                  <Input
                    id="capture-name"
                    value={capture?.name ?? ""}
                    maxLength={60}
                    onChange={(event) =>
                      setCapture((prev) =>
                        prev ? { ...prev, name: event.target.value } : prev,
                      )
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCapture(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={() => void startCaptureCall()}
                  disabled={
                    captureCall.isPending ||
                    (capture?.to.trim().length ?? 0) === 0 ||
                    (capture?.name.trim().length ?? 0) === 0
                  }
                >
                  <PhoneOutgoing className="mr-1.5 size-4" />
                  {captureCall.isPending
                    ? t("settingsMore.greetingCalling")
                    : t("settingsMore.greetingCallMe")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settingsMore.greetingDeleteTitle", {
                name: pendingDelete?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("settingsMore.greetingDeleteBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              {t("settingsMore.greetingKeepIt")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void runDelete()}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

/**
 * The phone flow's two states.
 *
 * "form" is asking; "calling" is the leg being out there. They share one dialog
 * because they are one errand — an owner who steps away mid-call comes back to
 * the same window that told them what to do, not to a closed one.
 */
interface CaptureState {
  phase: "form" | "calling";
  name: string;
  to: string;
}
