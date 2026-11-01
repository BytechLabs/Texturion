"use client";

import { useEffect } from "react";

import { whenPageSettles } from "@/lib/perf/after-lcp-and-load";

import { GTM_RELEASE } from "./gtm-release";

type Release = (() => void) | "go" | "done" | undefined;

/**
 * Releases the gtm.js download once the page has settled (#640). The loader
 * script in google-tag-manager.tsx has already seeded the consent default.
 *
 * Nothing is released after the marketing shell unmounts: a visitor who
 * reaches the app before the page settles must not get the container there
 * (#577). The loader marks itself "done" once it has run, so a remounted
 * shell does not load the container a second time.
 */
export function GtmBoot() {
  useEffect(() => {
    let live = true;
    void whenPageSettles().then(() => {
      if (!live) return;
      const w = window as unknown as Record<string, Release>;
      const release = w[GTM_RELEASE];
      if (typeof release === "function") release();
      else if (release !== "done") w[GTM_RELEASE] = "go";
    });
    return () => {
      live = false;
    };
  }, []);
  return null;
}
