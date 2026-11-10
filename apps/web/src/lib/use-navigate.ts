"use client";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { useCallback, useContext } from "react";

/**
 * #712: client-side navigation for a menu action, without `useRouter`'s
 * throw when no app router is mounted.
 *
 * A record's action list is built inside the same hook on every surface that
 * shows the record, including a row rendered in a unit test or a Storybook-style
 * harness. `useRouter` refuses to run there; this reads the SAME context it
 * reads and falls back to a plain navigation, so the action still does the
 * right thing in a real browser and the builder never has to care.
 */
export function useNavigate(): (
  href: string,
  options?: { replace?: boolean; scroll?: boolean },
) => void {
  const router = useContext(AppRouterContext);
  return useCallback(
    (href: string, options?: { replace?: boolean; scroll?: boolean }) => {
      if (router) {
        const nav = options?.scroll === undefined ? undefined : { scroll: options.scroll };
        if (options?.replace) router.replace(href, nav);
        else router.push(href, nav);
      } else if (options?.replace) window.location.replace(href);
      else window.location.assign(href);
    },
    [router],
  );
}
