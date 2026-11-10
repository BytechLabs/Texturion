"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * #694: the "Single-key shortcuts" setting (WCAG 2.1.4).
 *
 * Web preferences in this app (sidebar, contact panel, theme) are kept in the
 * browser, so this one is too. The default is on. Reading never throws: storage
 * can be blocked, and then the shortcuts simply stay on.
 */
const KEY = "loonext.inbox.single-key-shortcuts";
const CHANGED = "loonext:single-key-shortcuts";

export function readSingleKeyShortcuts(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSingleKeyShortcuts(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "off");
  } catch {
    // Storage blocked: the change lasts until the page reloads.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSingleKeyShortcuts(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readSingleKeyShortcuts, () => true);
  const set = useCallback((next: boolean) => writeSingleKeyShortcuts(next), []);
  return [enabled, set];
}
