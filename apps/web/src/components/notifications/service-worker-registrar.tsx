"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/push/register";

/**
 * Registers /sw.js on app boot (G9: push delivery + the offline app-shell
 * fallback). Render-null, mounted once in the root layout. Registration
 * never prompts for anything — notification permission stays a user-initiated
 * act in the settings card (G8).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
