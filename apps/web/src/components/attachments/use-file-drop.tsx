"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Native drag-and-drop file intake (D28 — no new dependency, just
 * DataTransfer events). Spread `handlers` on a container and render
 * `<DropOverlay active={active} />` inside it (the container needs
 * `position: relative`). Only reacts to drags that actually carry files —
 * text selections and in-app element drags pass through untouched.
 *
 * A depth counter keeps the overlay steady while the drag crosses child
 * elements (enter/leave fire per node); the overlay itself is
 * pointer-events-none so it never steals the drop.
 */
export function useFileDrop(onFiles: (files: FileList) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  // Ref-mirror the callback so the handlers keep a stable identity even when
  // the caller passes a fresh closure every render (e.g. mode-dependent).
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setActive(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    // Required — without it the browser navigates to the dropped file.
    event.preventDefault();
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setActive(false);
    if (event.dataTransfer.files.length > 0) {
      onFilesRef.current(event.dataTransfer.files);
    }
  }, []);

  return {
    active,
    handlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}

/** True when the drag payload contains files (not a text/element drag). */
function dragHasFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * The quiet dropzone affordance (D28): a stone dashed border + one plain line,
 * shown only while a file drag hovers the surface. Decorative (aria-hidden) —
 * the drop handling lives on the container, and keyboard users have the
 * attach button.
 *
 * While an upload is in flight (`pending`) the surface only takes one batch at a
 * time, so the overlay relabels to "Uploading — wait to add more" rather than
 * inviting a drop that the section would only reject.
 */
export function DropOverlay({
  active,
  pending = false,
}: {
  active: boolean;
  pending?: boolean;
}) {
  if (!active) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-background/90 text-[13px] font-medium text-muted-foreground"
    >
      {pending ? "Uploading, wait to add more" : "Drop to attach"}
    </div>
  );
}
