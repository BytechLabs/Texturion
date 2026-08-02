"use client";

import type { ReactNode } from "react";

import { canSeeSettingsSection, type SettingsSectionId } from "@loonext/shared";

import { useActiveCompany } from "@/lib/company/provider";

/**
 * #515 — a link to Settings that only appears to somebody who can open it.
 *
 * # Why this exists
 *
 * Closing the route gap turned every unguarded link into a dead end. The app
 * offers Settings destinations from all over: the workspace status banner
 * points at billing when a card fails, the composer's saved-reply picker
 * points at templates, the command palette lists templates, and the
 * waiting-room card offers "Invite your crew". None of them checked who was
 * looking, because until now the page would render for anyone.
 *
 * A gate that produces a wall somebody was invited to walk into is worse than
 * the leak it closed — the leak was quiet, and this is a promise broken in
 * front of them.
 *
 * # Why hide rather than disable
 *
 * A disabled control still says "there is something here for you". For a
 * member who will never hold `settings.manage`, that is a permanent small lie.
 * The nav already hides these sections from them; a link elsewhere in the app
 * should behave the same way, or the two disagree about whether the section
 * exists.
 *
 * # The `fallback`
 *
 * Some of these links are the ONLY action on their surface — the empty state
 * of the template picker is "you have no saved replies" plus a link to make
 * one. Removing the link leaves a sentence that trails off, so a caller can
 * supply what a person without access should read instead. Callers that pass
 * nothing render nothing, which is right when the link is one option among
 * several.
 */
export function SettingsLink({
  section,
  children,
  fallback = null,
}: {
  section: SettingsSectionId;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role } = useActiveCompany();
  return <>{canSeeSettingsSection(section, role) ? children : fallback}</>;
}

/**
 * The same question, for callers that build a list rather than wrap a node.
 *
 * The command palette and the status banner assemble arrays of destinations,
 * where a wrapper component cannot reach — they need to filter before they
 * render.
 */
export function useCanOpenSettings(): (section: SettingsSectionId) => boolean {
  const { role } = useActiveCompany();
  return (section) => canSeeSettingsSection(section, role);
}
