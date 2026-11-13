"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

type TimerRef = { current: ReturnType<typeof setTimeout> | null };

const SAVED_FLASH_MS = 2000;

function unchanged<T>(draft: T): T {
  return draft;
}

function clearTimer(timer: TimerRef) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
}

// Saves 800ms after the last keystroke, at once on blur, and once more on unmount or pagehide.
// `save` returns the request's promise (mutateAsync): mutate's per-call callbacks fire only for the latest call.
export function useDebouncedAutosave<T>({
  value,
  save,
  normalize = unchanged,
  delayMs = 800,
}: {
  /** The server's current value. */
  value: T;
  save: (value: T) => Promise<unknown>;
  /** The form a draft is compared and saved in, for example trimmed. */
  normalize?: (draft: T) => T;
  delayMs?: number;
}) {
  const [draft, setDraftState] = useState(value);
  const [state, setState] = useState<AutosaveState>("idle");
  const [error, setError] = useState<unknown>(null);

  // Refs, so no effect re-runs when the caller's mutation object changes.
  const draftRef = useRef(value);
  const saveRef = useRef(save);
  saveRef.current = save;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;

  const lastSaved = useRef(normalize(value));
  // What the newest request carries, so a flush while it is in flight does not send it twice.
  const lastSent = useRef(lastSaved.current);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const flush = useCallback(() => {
    clearTimer(timer);
    const next = normalizeRef.current(draftRef.current);
    if (Object.is(next, lastSent.current)) return;
    lastSent.current = next;
    const id = ++requestId.current;
    clearTimer(savedTimer);
    setState("saving");
    setError(null);
    saveRef.current(next).then(
      () => {
        if (id !== requestId.current) return;
        lastSaved.current = next;
        if (!mounted.current) return;
        setState("saved");
        savedTimer.current = setTimeout(() => {
          savedTimer.current = null;
          setState("idle");
        }, SAVED_FLASH_MS);
      },
      (cause: unknown) => {
        if (id !== requestId.current) return;
        lastSent.current = lastSaved.current;
        if (!mounted.current) return;
        setState("error");
        setError(cause);
      },
    );
  }, []);

  const setDraft = useCallback(
    (next: T) => {
      draftRef.current = next;
      setDraftState(next);
      clearTimer(savedTimer);
      setState((current) => (current === "saved" ? "idle" : current));
      clearTimer(timer);
      timer.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );

  // A teammate's change refreshes the field only while nothing of yours is unsent or in flight.
  useEffect(() => {
    const incoming = normalizeRef.current(value);
    if (Object.is(incoming, lastSaved.current)) return;
    const idle =
      Object.is(lastSent.current, lastSaved.current) &&
      Object.is(normalizeRef.current(draftRef.current), lastSaved.current);
    if (!idle) return;
    lastSaved.current = incoming;
    lastSent.current = incoming;
    draftRef.current = value;
    setDraftState(value);
  }, [value]);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener("pagehide", flush);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", flush);
      clearTimer(savedTimer);
      flush();
    };
  }, [flush]);

  return { draft, setDraft, onBlur: flush, state, error };
}
