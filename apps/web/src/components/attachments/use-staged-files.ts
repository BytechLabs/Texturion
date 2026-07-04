"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { partitionAttachmentFiles } from "@/lib/attachments/validate";

import type { StagedFile } from "./staged-file-chips";

/**
 * Client-side staging for note attachments (D28): files picked, dropped, or
 * pasted into a note composer are validated against the D19 rules at admission
 * (25 MB, allow-list, 10-per-note — `partitionAttachmentFiles`) and held as
 * plain Files until the note saves. Rejections toast one plain sentence per
 * distinct reason (dropping 5 oversize files nags once, not five times).
 *
 * `restore` puts a cleared draft back when the note create fails — the same
 * clear-immediately/restore-on-error idiom as the composer's text draft.
 */
export function useStagedFiles() {
  const [files, setFiles] = useState<StagedFile[]>([]);
  // Mirror for `admit` so its identity stays stable while reading fresh state
  // (toasting inside a setState updater would double-fire under StrictMode).
  const filesRef = useRef(files);
  filesRef.current = files;

  const admit = useCallback((incoming: FileList | File[]) => {
    const { accepted, rejected } = partitionAttachmentFiles(
      Array.from(incoming),
      filesRef.current.length,
    );
    for (const reason of new Set(rejected.map((r) => r.reason))) {
      toast.error(reason);
    }
    if (accepted.length > 0) {
      setFiles((current) => [
        ...current,
        ...accepted.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((current) => current.filter((staged) => staged.id !== id));
  }, []);

  const clear = useCallback(() => setFiles([]), []);

  const restore = useCallback((previous: StagedFile[]) => {
    setFiles(previous);
  }, []);

  return { files, admit, remove, clear, restore };
}
