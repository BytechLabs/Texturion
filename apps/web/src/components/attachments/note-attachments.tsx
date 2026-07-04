"use client";

import { ChevronDown, Paperclip } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { AttachmentsSection } from "./attachments-section";

/**
 * The internal-note attachment area (D19 / APP-FEATURES-V2 §2). A note is a
 * `messages` row (`direction='note'`), so its attachments are generic
 * `owner_type='note'` rows keyed by the note's message id.
 *
 * Rendered under a note bubble as a quiet disclosure — a small "Files" toggle
 * (stone, never petrol) that, when opened, mounts the shared
 * `AttachmentsSection` (attach button + existing attachments). Kept collapsed by
 * default so the thread stays calm and a note with no interest in files costs no
 * fetch; opening it is one tap and the per-owner list caches, so re-opening
 * (e.g. after the virtualized row re-mounts) is instant.
 *
 * Aligned to the note bubble's right edge (notes are right-aligned like
 * outbound) and constrained so the file rows never exceed the bubble measure.
 */
export function NoteAttachments({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full max-w-[min(90%,20rem)] self-end">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "tap-target flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
        )}
      >
        <Paperclip className="size-3" strokeWidth={1.75} aria-hidden />
        Files
        <ChevronDown
          className={cn(
            "size-3 transition-transform duration-150 ease-out",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open && (
        <div className="mt-1.5">
          <AttachmentsSection noteId={noteId} compact />
        </div>
      )}
    </div>
  );
}
