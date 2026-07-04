"use client";

import { Paperclip, X } from "lucide-react";

import { formatBytes } from "@/components/thread/gallery-grouping";
import { cn } from "@/lib/utils";

/** One file staged in a composer, waiting for the note to be created (D28). */
export interface StagedFile {
  id: string;
  file: File;
}

/**
 * The staged-file chip row for note composers (D28): each picked/dropped/pasted
 * file shows as a quiet amber chip — name + size + a remove control — ABOVE the
 * input, before anything touches the network. Files upload only after the note
 * saves (create note → POST each file with the note id), so removing a chip is
 * free. Amber matches the note surface (notes are the amber region); the chips
 * wrap on narrow screens (375px sanity).
 */
export function StagedFileChips({
  files,
  onRemove,
  className,
}: {
  files: StagedFile[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (files.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {files.map(({ id, file }) => {
        const name = file.name || "File";
        const size = formatBytes(file.size);
        return (
          <span
            key={id}
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-app-amber-line bg-app-amber-bg py-0.5 pl-2.5 pr-1 text-xs text-app-amber-ink"
          >
            <Paperclip className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="max-w-40 truncate">{name}</span>
            {size && (
              <span className="shrink-0 tabular-nums text-app-amber-ink/70">
                {size}
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={`Remove ${name}`}
              className="tap-target flex size-5 shrink-0 items-center justify-center rounded-full text-app-amber-ink/80 transition-colors duration-150 ease-out hover:bg-app-amber-line/60 hover:text-app-amber-ink"
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
