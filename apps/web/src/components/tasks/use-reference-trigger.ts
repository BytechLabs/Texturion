"use client";

import { referenceQueryAt } from "@loonext/shared";
import { useRef, useState } from "react";

/**
 * #690: opens the reference picker when a `#` is typed at the start of a word,
 * and puts the chosen reference where the `#` was.
 *
 * Used by the internal text fields only (a note, a task description, a task
 * comment). The composer for a text to a customer does not use it, so a `#`
 * typed there is never offered anything and never read as a link.
 *
 * Like the mention picker, it opens from the TYPED text and not from a key
 * press, because a soft keyboard reports every key as "Unidentified". The `#`
 * stays in the draft if the picker is dismissed.
 */
export function useReferenceTrigger(getValue: () => string, setValue: (next: string) => void) {
  const [open, setOpen] = useState(false);
  const hashAt = useRef(-1);

  /** Call from the field's change handler with the new text and caret. */
  const onTyped = (next: string, caret: number) => {
    const at = referenceQueryAt(next, caret);
    if (at !== null && at.query === "") {
      hashAt.current = at.start;
      setOpen(true);
    }
  };

  /** Replace the `#` that opened the picker with the chosen reference. */
  const onPick = (text: string) => {
    const value = getValue();
    const start = hashAt.current;
    if (start >= 0 && value[start] === "#") {
      setValue(`${value.slice(0, start)}${text} ${value.slice(start + 1)}`);
    } else {
      setValue(`${value}${value === "" || value.endsWith(" ") ? "" : " "}${text} `);
    }
    hashAt.current = -1;
  };

  return { open, setOpen, onTyped, onPick };
}
