import type { Metadata } from "next";

import { SettingsShell } from "@/components/settings/settings-shell";

import { SettingsSectionGate } from "./section-gate";

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
  return (
    <SettingsShell>
      {/*
        #515 — the gate lives HERE, at the one boundary every settings URL
        passes through, rather than in each page. Sixteen pages is sixteen
        chances to forget, and the seventeenth is written by someone who never
        read this comment. Inside the shell rather than around it so a refused
        reader keeps the nav: they are told no about one section, not turned
        out of settings.
      */}
      <SettingsSectionGate>{children}</SettingsSectionGate>
    </SettingsShell>
  );
}
