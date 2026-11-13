"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { hasLiveBrowserCall } from "@/lib/softphone/live-call";

/** How long the tab must have been out of sight before it reloads itself. */
export const HIDDEN_BEFORE_RELOAD_MS = 60_000;

const OPEN_DIALOG = "[role=dialog][data-state=open], [role=alertdialog][data-state=open]";

/** Nothing a reload would lose: no call, no save in flight, no open form. */
function canReloadNow(queryClient: QueryClient): boolean {
  return (
    !hasLiveBrowserCall() &&
    queryClient.isMutating() === 0 &&
    document.querySelector(OPEN_DIALOG) === null
  );
}

/**
 * Moves a tab onto the live build while nobody is looking at it.
 *
 * Once `stale` is true and the tab has been hidden for a minute, it reloads,
 * unless a call, a save or a dialog is open, in which case it asks again a
 * minute later. A visible tab is never reloaded; the update card covers it.
 * Composer drafts are written on pagehide, so they survive the reload.
 */
export function useReloadWhenStale(stale: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!stale) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reloadIfStillHidden = () => {
      if (document.visibilityState !== "hidden") return;
      if (canReloadNow(queryClient)) window.location.reload();
      else timer = setTimeout(reloadIfStillHidden, HIDDEN_BEFORE_RELOAD_MS);
    };
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") {
        timer = setTimeout(reloadIfStillHidden, HIDDEN_BEFORE_RELOAD_MS);
      }
    };

    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [stale, queryClient]);
}
