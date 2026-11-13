"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { roleHasCapability } from "@loonext/shared";

import {
  LANDED_KEY,
  rememberLandingRole,
  useActiveCompany,
} from "@/lib/company/provider";

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
 *
 * The role it resolves is remembered per user and workspace, so the next launch
 * can make the member hop before /v1/me answers (CompanyProvider). A stale hint
 * costs one landing on For you, and this rewrites it.
 */
export function LandingGate() {
  const pathname = usePathname();
  const router = useRouter();
  const { role, userId, companyId } = useActiveCompany();
  const decidedRef = useRef(false);

  useEffect(() => {
    rememberLandingRole(userId, companyId, role);
  }, [userId, companyId, role]);

  useEffect(() => {
    if (decidedRef.current) return;

    // #315: a role with no inbox has nowhere to land. Every primary surface in
    // this app is a conversation surface, so a bookkeeper — billing and
    // nothing else — would be dropped on a screen that answers 403. They go to
    // the one thing they can work.
    //
    // Deliberately NOT once-per-session like the member redirect below: that
    // one is a preference (a member may click Inbox later and stay there),
    // this one is a wall. Sending them back to /inbox on a second visit would
    // just show them the 403 again.
    if (!roleHasCapability(role, "conversations.read")) {
      decidedRef.current = true;
      if (pathname === "/inbox" || pathname === "/for-you") {
        router.replace("/settings/billing");
      }
      return;
    }

    // Only members are redirected to /for-you; leads land on the inbox.
    if (role !== "member") {
      decidedRef.current = true;
      return;
    }

    // Once per browser session — set the marker as soon as the app renders so a
    // later manual Inbox visit never re-triggers the redirect.
    let alreadyLanded = false;
    try {
      alreadyLanded = sessionStorage.getItem(LANDED_KEY) === "1";
      sessionStorage.setItem(LANDED_KEY, "1");
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
