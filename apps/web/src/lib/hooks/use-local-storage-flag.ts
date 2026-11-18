"use client";

import { useState, useSyncExternalStore } from "react";

const FLAG_CHANGED = "loonext:storage-flag";

export function readStorageFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeStorageFlag(key: string, value = true): boolean {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(FLAG_CHANGED));
  return true;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(FLAG_CHANGED, onChange);
  return () => window.removeEventListener(FLAG_CHANGED, onChange);
}

export function useLocalStorageFlag<ServerValue extends boolean | null>(
  key: string,
  serverValue: ServerValue,
): [boolean | ServerValue, (value: boolean) => void] {
  const [fallback, setFallback] = useState<{ key: string; value: boolean } | null>(null);
  const stored = useSyncExternalStore<boolean | ServerValue>(
    subscribe,
    () => readStorageFlag(key),
    () => serverValue,
  );
  const value = fallback?.key === key ? fallback.value : stored;

  function set(next: boolean) {
    setFallback(writeStorageFlag(key, next) ? null : { key, value: next });
  }

  return [value, set];
}
