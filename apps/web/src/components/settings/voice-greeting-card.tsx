"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";
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
import { ApiError } from "@/lib/api/error";
import {
  formatDuration,
  MAX_GREETING_MS,
  useDeleteGreeting,
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
 * - **Icons from Lucide**, never emoji.
 */
export function VoiceGreetingCard({ canEdit }: { canEdit: boolean }) {
  const greetings = useVoicemailGreetings();
  const record = useRecordGreeting();
  const remove = useDeleteGreeting();

  const [take, setTake] = useState<{ blob: Blob; url: string; ms: number } | null>(
    null,
  );
  const [name, setName] = useState(DEFAULT_NAME);
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
      setMicError(
        "Your browser did not give us the microphone. Allow it in the address bar, then try again.",
      );
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
      toast.error(
        "That is longer than two minutes. A caller waiting for the beep will hang up first.",
      );
      return;
    }
    try {
      await record.mutateAsync({ name: name.trim(), blob: take.blob, durationMs: take.ms });
      discard();
      setName(DEFAULT_NAME);
      toast.success("Saved. Choose it on a number to use it.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "That could not be saved.",
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
      toast.success("Deleted.");
    } catch (cause) {
      toast.error(
        cause instanceof ApiError ? cause.message : "That could not be deleted.",
      );
    }
  }

  const rows = greetings.data?.data ?? [];

  return (
    <SettingsCard
      title="Your own voice"
      description="Record the greeting yourself instead of having it read aloud. Callers hear a person, which is the thing you are actually selling."
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {rows.length === 0
            ? "Nothing recorded yet — callers hear the written greeting, read aloud."
            : "Pick one on a number under Settings → Numbers to use it. Anything you have not chosen stays unused."}
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
                    aria-label={`Delete ${row.name}`}
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
                  <p className="text-sm font-medium">Hear it back</p>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the
                      audio IS the content; a caption would be a transcript of
                      the owner's own recording, which they just spoke. */}
                  <audio src={take.url} controls className="w-full" />
                  <p className="text-[12px] text-app-muted-2">
                    {formatDuration(take.ms)} · this is exactly what a caller
                    gets.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="greeting-name">Name it</Label>
                  <Input
                    id="greeting-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={discard} disabled={record.isPending}>
                    Record again
                  </Button>
                  <Button
                    onClick={() => void save()}
                    disabled={record.isPending || name.trim().length === 0}
                  >
                    {record.isPending ? "Saving…" : "Save greeting"}
                  </Button>
                </div>
              </>
            ) : recording ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Recording… speak now.</span>
                <Button onClick={stop} variant="destructive">
                  <Square className="mr-1.5 size-4" />
                  Stop
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Up to two minutes.
                </span>
                <Button onClick={() => void start()}>
                  <Mic className="mr-1.5 size-4" />
                  Record
                </Button>
              </div>
            )}
            {micError && (
              <p role="alert" className="text-sm text-destructive">
                {micError}
              </p>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &quot;{pendingDelete?.name}&quot;?</DialogTitle>
            <DialogDescription>
              Any number using it goes back to the written words, read aloud.
              Callers hear the change on the next call.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void runDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

/**
 * What most owners are recording, so the field is never empty.
 *
 * It is still editable — a workspace with a holiday greeting and a truck
 * greeting needs to say which is which — but nobody should have to think of a
 * name before they can hear their first take.
 */
const DEFAULT_NAME = "After hours";
