"use client";

import { useEffect } from "react";

/**
 * A render-null window-level guard against stray file drops (D28 / finding #7).
 *
 * The composer/task dropzones own their own drop targets, but a file dropped
 * anywhere ELSE in the window (missing the dropzone by a few pixels, landing on
 * the sidebar, the thread scroll) would otherwise make the browser NAVIGATE
 * away to the file — losing the user's unsent draft. This cancels the browser's
 * default file-open on `dragover` + `drop` at the window, gated on the drag
 * actually carrying files so text selections and in-app element drags are
 * untouched.
 *
 * The container-level `useFileDrop` handlers still fire first (capture order:
 * the event bubbles up to the window last), so a drop that DID hit a dropzone
 * is already handled and `preventDefault`ed by the time it reaches here — this
 * only catches the misses. Mounted once app-wide (the AppShell).
 */
export function WindowDropGuard() {
  useEffect(() => {
    function hasFiles(event: DragEvent): boolean {
      return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    function onDrop(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return null;
}
