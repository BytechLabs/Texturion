"use client";

import type { MouseEvent } from "react";

import { AiOrb } from "@/components/ui/ai-orb";
import { useT } from "@/i18n/provider";

/** A click that Enter or Space produced, rather than a pointer. */
const fromKeyboard = (event: MouseEvent) => event.detail === 0;

/**
 * #716: Lou offering a catch-up, as one line above the composer's Lou orb.
 *
 * It replaces the card's resting row above the stream, which was a second
 * block of chrome before the first message on every long thread. It asks for
 * nothing by itself: Recap is the press that spends a call, and Not now is
 * never a dead end, because the header menu keeps Catch me up.
 *
 * A hairline and paper, no shadow and no motion of its own: it is a remark
 * beside the input, not a layer over it. *Applying: Zen of Clarity (one line,
 * two choices) and Prioritize Intent (it sits beside the input it interrupts
 * least).*
 */
export function CatchUpHint({
  onRecap,
  onNotNow,
  returnFocus,
}: {
  onRecap: () => void;
  onNotNow: () => void;
  /**
   * Where focus goes after a keyboard answer, since the control that held it is
   * gone. Not called for a tap: focusing the input on a phone opens the keyboard.
   */
  returnFocus: () => void;
}) {
  const t = useT();
  const answer = (act: () => void, keyboard: boolean) => {
    act();
    if (keyboard) returnFocus();
  };
  return (
    <div className="mx-auto max-w-[42rem] px-1 pb-2">
      <div
        role="status"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          answer(onNotNow, true);
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-app-card border border-app-line bg-app-paper py-1 pl-2.5 pr-1"
      >
        <AiOrb size={14} />
        <span className="min-w-0 truncate text-[13px] text-app-ink">
          {t("thread.catchUpHint")}
        </span>
        <button
          type="button"
          // Says what pressing it does, because pressing it is what costs.
          title={t("thread.louReadsRecent")}
          onClick={(event) => answer(onRecap, fromKeyboard(event))}
          className="tap-target shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-app-olive-deep transition-colors duration-150 ease-out hover:bg-app-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("thread.catchUpRecap")}
        </button>
        <button
          type="button"
          onClick={(event) => answer(onNotNow, fromKeyboard(event))}
          className="tap-target shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-app-muted transition-colors duration-150 ease-out hover:bg-app-hover hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("thread.notNow")}
        </button>
      </div>
    </div>
  );
}
