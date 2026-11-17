"use client";

import { REALTIME_BACKGROUND_GRACE_MS } from "@loonext/shared";
import { createContext, useEffect, useState } from "react";

export const RealtimePausedContext = createContext(false);

export function useRealtimePaused() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onVisibility() {
      clearTimeout(timer);
      if (document.hidden) {
        timer = setTimeout(() => setPaused(true), REALTIME_BACKGROUND_GRACE_MS);
      } else {
        setPaused(false);
      }
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return paused;
}
