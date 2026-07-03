"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The persisted nav-rail collapsed/expanded preference (APP-LAYOUT-V2 §1.3 —
 * one of the two MVP layout knobs). Collapsed → the 64px icon rail; expanded →
 * the 240px labelled rail. Persisted in localStorage; shared across every
 * subscriber via a tiny external store so a toggle in one place updates all.
 *
 * Only meaningful at ≥1024px (the tablet breakpoint forces the icon rail via
 * CSS regardless); below 1024px this preference is simply not read.
 */
const KEY = "jobtext:nav-rail-collapsed";

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Reflect a toggle made in another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRailCollapsed(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  const toggle = useCallback(() => {
    const next = !read();
    try {
      window.localStorage.setItem(KEY, String(next));
    } catch {
      // Preference only — losing it is harmless.
    }
    emit();
  }, []);

  return { collapsed, toggle };
}
