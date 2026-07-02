"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * /settings index. Mobile: the layout renders the stacked section list, so
 * this page contributes nothing. Desktop: hop straight to the first section —
 * an empty right pane helps nobody.
 */
export default function SettingsIndexPage() {
  const router = useRouter();

  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      router.replace("/settings/workspace");
    }
  }, [router]);

  return (
    <p className="hidden text-sm text-muted-foreground lg:block">
      Opening workspace settings…
    </p>
  );
}
