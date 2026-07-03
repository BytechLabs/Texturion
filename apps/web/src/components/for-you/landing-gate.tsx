"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useActiveCompany } from "@/lib/company/provider";

/**
 * D23 default member landing. A member signing in should land on their focus
 * queue (/for-you), owners/admins on the shared inbox. The auth flow (edge
 * middleware + the login page) can't make that call — the role only exists
 * after GET /v1/me resolves client-side — so the redirect happens here, once,
 * on the FIRST app screen of a browser session.
 *
 * It fires only when a member's initial in-session destination is the inbox
 * root (`/inbox`) — the generic post-auth landing. A deliberate Inbox click
 * later in the session is untouched (the once-per-session guard has already
 * been consumed), and owners/admins are never redirected. A member who was
 * deep-linked to a specific thread (`/inbox/:id`) is also left alone — that is
 * an intentional destination, not the generic landing.
 */
export function LandingGate() {
  const pathname = usePathname();
  const router = useRouter();
  const { role } = useActiveCompany();
  const decidedRef = useRef(false);

  useEffect(() => {
    if (decidedRef.current) return;

    // Only members are redirected to /for-you; leads land on the inbox.
    if (role !== "member") {
      decidedRef.current = true;
      return;
    }

    // Once per browser session — set the marker as soon as the app renders so a
    // later manual Inbox visit never re-triggers the redirect.
    const KEY = "jt-landed";
    let alreadyLanded = false;
    try {
      alreadyLanded = sessionStorage.getItem(KEY) === "1";
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Private mode / storage disabled: fall back to the per-mount guard only.
    }
    decidedRef.current = true;
    if (alreadyLanded) return;

    // The generic post-auth landing is the inbox root; send members onward.
    if (pathname === "/inbox") {
      router.replace("/for-you");
    }
  }, [role, pathname, router]);

  return null;
}
