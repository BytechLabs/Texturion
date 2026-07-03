"use client";

import * as React from "react";
import { toast } from "sonner";

/**
 * Optimistic action + 5s undo (APP-UI-ELEVATION.md §4, §5) — the single biggest
 * "feels effortless" lever. Routine, reversible actions (close, reopen, assign,
 * mark-spam, archive) apply INSTANTLY and offer one quiet "Undo" for 5 seconds.
 * No confirm modal, no spinner. Reserve typed confirmation only for the truly
 * irreversible (delete-number, account destruction).
 *
 * SHARED PRIMITIVE. Lives in components/ui so inbox, thread, contacts, and
 * settings all consume one implementation. Two entry points:
 *
 *   • undoableToast(...)     — the toast half only, when the caller has already
 *                              applied the change optimistically (e.g. a
 *                              TanStack mutation with an onMutate cache patch).
 *
 *   • useUndoableAction()    — the whole lifecycle: run the forward action, show
 *                              the undo toast, and run the inverse on "Undo",
 *                              with a guard so undo can only fire while the
 *                              window is open (never after commit).
 *
 * The 5s duration and the single "Undo" action are the spec contract; do not
 * lengthen the window or add a second action.
 */

const UNDO_DURATION_MS = 5000;

export interface UndoableToastOptions {
  /** Past-tense, one clause: "Conversation closed", "Marked as spam". */
  message: string;
  /** Runs the inverse. Errors should surface their own toast/banner. */
  onUndo: () => void;
  /**
   * Optional: called once the undo window closes WITHOUT an undo — the point at
   * which the action is truly committed (e.g. flush a deferred server write).
   * Not called if the user hits Undo.
   */
  onCommit?: () => void;
}

/**
 * Show the quiet "done — Undo" toast for a change that is already applied
 * optimistically. Bottom, 5s, one action. Returns the sonner toast id.
 */
export function undoableToast({
  message,
  onUndo,
  onCommit,
}: UndoableToastOptions): string | number {
  let undone = false;
  return toast(message, {
    duration: UNDO_DURATION_MS,
    action: {
      label: "Undo",
      onClick: () => {
        undone = true;
        onUndo();
      },
    },
    // sonner fires onAutoClose on timeout and onDismiss on manual close; commit
    // when the window closes and Undo was not taken.
    onAutoClose: () => {
      if (!undone) onCommit?.();
    },
  });
}

export interface UndoableActionConfig {
  /** Applies the change immediately (optimistic). Runs before the toast. */
  apply: () => void;
  /** Reverses `apply`. Runs only if the user hits Undo within 5s. */
  undo: () => void;
  /** Past-tense toast message. */
  message: string;
  /**
   * Optional commit hook when the window closes without an undo. Use to flush a
   * write you deferred to make undo instant; omit when `apply` already persisted.
   */
  commit?: () => void;
}

/**
 * useUndoableAction — run a routine reversible action optimistically with a 5s
 * undo, as one call. Returns a stable `run` you can wire to a button/menu item.
 *
 *   const runClose = useUndoableAction();
 *   runClose({
 *     apply: () => update.mutate({ status: "closed" }),
 *     undo:  () => update.mutate({ status: "open" }),
 *     message: "Conversation closed",
 *   });
 *
 * The guard ensures a stale toast's Undo cannot fire after a newer action on
 * the same hook instance has started.
 */
export function useUndoableAction() {
  const tokenRef = React.useRef(0);

  return React.useCallback((config: UndoableActionConfig) => {
    const token = ++tokenRef.current;
    config.apply();
    undoableToast({
      message: config.message,
      onUndo: () => {
        // Ignore an Undo from a superseded action on this hook instance.
        if (token !== tokenRef.current) return;
        config.undo();
      },
      onCommit: config.commit,
    });
  }, []);
}
