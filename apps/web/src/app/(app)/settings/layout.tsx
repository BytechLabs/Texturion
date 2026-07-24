import type { Metadata } from "next";

import { SettingsShell } from "@/components/settings/settings-shell";

/**
 * Settings section layout (G8). This thin SERVER layout exists to give every
 * settings screen a "Settings" tab title (the interactive shell is a client
 * component and can't export metadata); individual pages that set their own
 * title still win. The nav + responsive behavior live in SettingsShell.
 */
export const metadata: Metadata = { title: "Settings" };

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <SettingsShell>{children}</SettingsShell>;
}
