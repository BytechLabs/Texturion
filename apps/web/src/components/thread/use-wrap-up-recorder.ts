"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, useT, type Translate } from "@/i18n/provider";

/**
 * #507 Phase 1 — capturing the crew member's own voice, in the browser.
 *
 * The whole job is: hold the microphone for as long as somebody is talking,
 * hand back one blob, and never leave the mic light on. Everything that can go
 * wrong here (no MediaRecorder, a denied prompt, a remembered Block, no device
 * at all) resolves to a SENTENCE rather than a thrown error, because the
 * composer behind this control has to stay usable through every one of them —
 * dictation is a shortcut and typing is the product.
 *
 * WHOSE VOICE. The member's, about a call that has already ended. This never
 * touches a call leg, and the softphone's stream is a different acquisition
 * entirely (see the D117 note in lib/api/wrap-up-transcript.ts).
 */

/**
 * Containers worth asking for, best first.
 *
 * WebM/Opus is what Chromium and Firefox produce and is small; Safari answers
 * none of the WebM types and produces MP4/AAC. Every entry here is inside
 * Whisper's accepted set, so whichever one the browser agrees to is uploaded
 * as-is — transcoding in the tab would cost seconds and a megabyte of wasm to
 * arrive at a format the model already reads.
 */
/**
 * English, for a caller with no provider around it — `micFailureMessage` is
 * exported and unit-tested directly. The hook itself passes the reader's own.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/**
 * The first container this browser will record, or undefined to let it choose.
 *
 * Undefined is a real answer, not a failure: `new MediaRecorder(stream)` with
 * no options records in whatever the engine prefers, which is exactly right for
 * an engine whose `isTypeSupported` we could not interrogate.
 */
export function pickWrapUpMimeType(
  isTypeSupported: (type: string) => boolean,
): string | undefined {
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      // A browser that throws on the query has answered "no" for that type.
    }
  }
  return undefined;
}

/** Can this browser record at all? Checked before the prompt, never after. */
export function canRecordAudio(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Why the microphone could not be opened, in words a person can act on.
 *
 * Split by DOMException name because the recoveries are opposites: a blocked
 * permission is fixed in the browser's address bar and never by trying again,
 * and a missing device is fixed by plugging something in. Telling someone to
 * "try again" when the browser has remembered a Block is telling them to do the
 * one thing that cannot work.
 */
export function micFailureMessage(cause: unknown, t: Translate = EN): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return t("thread.micNotFound");
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return t("thread.micBlocked");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return t("thread.micBusy");
  }
  return t("thread.micUnreachable");
}

export interface WrapUpRecorder {
  /** True while the microphone is open and audio is accumulating. */
  recording: boolean;
  /** Whole seconds captured so far, for the live counter. */
  seconds: number;
  /**
   * Why the last attempt did not produce audio, as a finished sentence. Null
   * when there is nothing to report. Never thrown — see the module comment.
   */
  error: string | null;
  /** Open the mic and start capturing. Resolves once recording has begun (or failed). */
  start: () => Promise<void>;
  /** Stop and hand the audio over. */
  stop: () => void;
  /** Stop and throw the audio away — nothing is uploaded and nothing is spent. */
  cancel: () => void;
  clearError: () => void;
}

export function useWrapUpRecorder(options: {
  /** Stop ourselves at the server's ceiling rather than upload to be refused. */
  maxSeconds: number;
  /** The server's byte ceiling — a recording past it is refused before it costs upstream. */
  maxBytes: number;
  /** Called once per completed recording. Never called for a cancel. */
  onAudio: (audio: Blob, seconds: number) => void;
}): WrapUpRecorder {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * The latest `onAudio` and `maxSeconds`, so the callbacks below never close
   * over a stale render. A recording runs for up to two minutes while the
   * composer around it re-renders on every keystroke.
   */
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** Release the hardware. Called on every exit path, including unmount. */
  const releaseStream = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Leaving a tab with the mic light on is alarming and looks exactly like a
  // product that records without asking, which is the one impression this
  // feature cannot afford to give.
  //
  // The cancel flag is set FIRST, and that is the whole point of not passing
  // `releaseStream` directly as the cleanup. Stopping the tracks makes the
  // recorder fire `onstop`, which would otherwise upload and spend a metered
  // unit on a recording whose composer no longer exists — nobody is waiting for
  // those words, and nobody would ever see them.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      releaseStream();
    },
    [releaseStream],
  );

  const start = useCallback(async () => {
    if (recorderRef.current !== null) return;
    setError(null);

    if (!canRecordAudio()) {
      setError(t("thread.micNoRecorder"));
      return;
    }

    let stream: MediaStream;
    try {
      // Raises the browser's permission prompt on this click. A remembered
      // Block throws immediately with no prompt at all, which is why the
      // message below distinguishes it from "try again".
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setError(micFailureMessage(cause, t));
      return;
    }

    const mimeType = pickWrapUpMimeType((type) =>
      window.MediaRecorder.isTypeSupported(type),
    );
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      for (const track of stream.getTracks()) track.stop();
      setError(t("thread.micStartFailed"));
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setSeconds(0);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      // Clamped to the cap, not merely measured against it. The auto-stop
      // fires AT the ceiling, and `onstop` is delivered a moment later — so an
      // unclamped wall-clock reads 121 for a recording this hook deliberately
      // ended at 120, and the server refuses it. The one dictation we stopped
      // on the member's behalf would have been the one guaranteed to fail,
      // after paying to upload it.
      const elapsed = Math.min(
        optionsRef.current.maxSeconds,
        Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
      const cancelled = cancelledRef.current;
      releaseStream();
      setRecording(false);
      setSeconds(0);
      if (cancelled) return;

      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (audio.size === 0) {
        setError(t("thread.micNothingRecorded"));
        return;
      }
      // The server refuses this too; refusing here means a phone left in a
      // pocket never costs anybody an upload of it.
      if (audio.size > optionsRef.current.maxBytes) {
        setError(t("thread.micTooBig"));
        return;
      }
      optionsRef.current.onAudio(audio, elapsed);
    };
    // A recorder that errors mid-capture must not leave the button stuck in a
    // recording state with the mic still open.
    recorder.onerror = () => {
      cancelledRef.current = true;
      try {
        recorder.stop();
      } catch {
        releaseStream();
        setRecording(false);
        setSeconds(0);
      }
      setError(t("thread.micStoppedUnexpectedly"));
    };

    recorder.start();
    setRecording(true);

    // 250ms so the counter never sits a whole second behind what somebody is
    // watching, and so the ceiling lands within a quarter second of two
    // minutes rather than up to a second past it.
    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= optionsRef.current.maxSeconds) {
        // Stop ourselves at the ceiling. The audio captured up to here is
        // still handed over — two minutes of a wrap-up is a wrap-up, and
        // throwing it away because somebody ran long would be the cruellest
        // possible reading of a cap.
        recorderRef.current?.stop();
      }
    }, 250);
  }, [releaseStream, t]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder === null) return;
    cancelledRef.current = false;
    if (recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    cancelledRef.current = true;
    if (recorder !== null && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    releaseStream();
    setRecording(false);
    setSeconds(0);
  }, [releaseStream]);

  const clearError = useCallback(() => setError(null), []);

  return { recording, seconds, error, start, stop, cancel, clearError };
}
