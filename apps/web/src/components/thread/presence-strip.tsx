"use client";

import { presenceLabel, type Viewer } from "@loonext/shared";

/**
 * #302 — the one line that stops a second person mid-sentence.
 *
 * PLACED AT THE COMPOSER, not in the header. The header is read once when the
 * thread opens and then forgotten; the decision this exists to change — "I'll
 * answer this" — is made with a hand already on the keyboard. Six inches away
 * is the difference between information and decoration.
 *
 * ADVISORY AND QUIET. #302 is explicit that a lock would be worse than the
 * collision it prevents: the person holding one walks into a basement and the
 * customer waits. So this informs and gets out of the way — no colour that
 * competes with the customer's message, no animation pulling the eye off the
 * thread, nothing that can be clicked. A person who sees a colleague's name
 * simply stops, which is the entire mechanism.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING. `presenceLabel` returns null rather
 * than an empty string precisely so this can return null rather than reserve a
 * strip of space for an absence — and on a degraded connection the shared rule
 * has already emptied the list, because "we do not know" must look like silence
 * and not like "nobody is here".
 */
export function PresenceStrip({ viewers }: { viewers: readonly Viewer[] }) {
  const label = presenceLabel(viewers);
  if (!label) return null;

  const replying = viewers.some((viewer) => viewer.typing);

  return (
    <p
      // Announced politely: a teammate arriving on the thread is worth knowing
      // and never worth interrupting what a screen reader is already saying.
      aria-live="polite"
      className="flex items-center gap-1.5 px-4 pt-2 text-[12px] leading-none text-app-muted"
    >
      <span
        aria-hidden
        className={
          replying
            ? "size-1.5 shrink-0 rounded-full bg-app-olive"
            : "size-1.5 shrink-0 rounded-full bg-app-muted-2"
        }
      />
      {label}
    </p>
  );
}
