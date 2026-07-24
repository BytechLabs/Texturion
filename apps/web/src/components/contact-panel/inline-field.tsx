"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/error";
import { useUpdateContact, type ContactPatch } from "@/lib/api/contacts";
import { cn } from "@/lib/utils";

/**
 * Inline auto-saving fields (G6): click-to-edit text, and a notes textarea
 * that debounce-saves via PATCH /v1/contacts/:id with a quiet "Saved"
 * indicator. Errors restore nothing silently — the value stays so the user
 * can retry, with a toast naming what happened (G10).
 */

export function InlineTextField({
  contactId,
  field,
  value,
  label,
  placeholder,
  className,
  wrap = false,
}: {
  contactId: string;
  field: "name" | "address";
  value: string | null;
  label: string;
  placeholder: string;
  /** Extra classes for both the read button and the edit input (e.g. the
   * hero name's larger type). Additive via cn(); color/size overrides win. */
  className?: string;
  /** Read view wraps to two lines instead of truncating — for values like an
   * address that lose their meaning when cut at a narrow drawer width. */
  wrap?: boolean;
}) {
  const update = useUpdateContact(contactId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    const patch: ContactPatch = { [field]: trimmed === "" ? null : trimmed };
    update.mutate(patch, {
      onError: (error) =>
        toast.error(
          error instanceof ApiError
            ? error.message
            : `Couldn't save the ${field}. Try again.`,
        ),
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
        className={cn(
          "w-full rounded-md px-2 py-1 text-left text-sm transition-colors duration-150 ease-out hover:bg-secondary/60",
          wrap ? "line-clamp-2 break-words" : "truncate",
          value ? "text-foreground" : "text-muted-foreground",
          className,
        )}
      >
        {value || placeholder}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
      }}
      aria-label={label}
      className={cn(
        "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    />
  );
}

export function AutoSaveNotes({
  contactId,
  value,
}: {
  contactId: string;
  value: string | null;
}) {
  const update = useUpdateContact(contactId);
  const [draft, setDraft] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The "Saved" flash timer — tracked so it's cleared on unmount + before each
  // new save (a stray fire would setState after unmount or clobber a fresh save).
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(value ?? "");
  // Latest draft, so the unmount flush below reads the current text (the
  // cleanup closure would otherwise capture a stale `draft`).
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  // Server-side changes (another teammate) refresh an idle editor only.
  useEffect(() => {
    if ((value ?? "") !== lastSaved.current && draft === lastSaved.current) {
      lastSaved.current = value ?? "";
      setDraft(value ?? "");
    }
  }, [value, draft]);

  const onChange = (next: string) => {
    setDraft(next);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    timer.current = setTimeout(() => {
      const trimmed = next.trim() === "" ? null : next;
      if ((trimmed ?? "") === lastSaved.current) return;
      update.mutate(
        { notes: trimmed },
        {
          onSuccess: () => {
            lastSaved.current = trimmed ?? "";
            setSaved(true);
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSaved(false), 2000);
          },
          onError: (error) =>
            toast.error(
              error instanceof ApiError
                ? error.message
                : "Couldn't save notes. Try again.",
            ),
        },
      );
    }, 800);
  };
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (!timer.current) return;
      clearTimeout(timer.current);
      // Flush a pending debounced save so closing the panel within the 800ms
      // window doesn't silently drop the last note edit (fire-and-forget — the
      // component is unmounting, so no success/error setState).
      const trimmed =
        latestDraft.current.trim() === "" ? null : latestDraft.current;
      if ((trimmed ?? "") !== lastSaved.current) {
        update.mutate({ notes: trimmed });
      }
    },
    [update],
  );

  return (
    <div className="space-y-1">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Notes about this customer…"
        aria-label="Contact notes"
        // field-sizing-content (the shared ui/textarea idiom): the box grows
        // with the note instead of clipping it mid-word at the fixed 3 rows;
        // max-h keeps a runaway note scrollable, not panel-swallowing.
        className="field-sizing-content max-h-40 w-full resize-none overflow-y-auto rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <p
        aria-live="polite"
        className={cn(
          "h-4 text-right text-[11px] text-muted-foreground transition-opacity duration-150",
          update.isPending || saved ? "opacity-100" : "opacity-0",
        )}
      >
        {update.isPending ? "Saving…" : saved ? "Saved" : ""}
      </p>
    </div>
  );
}
