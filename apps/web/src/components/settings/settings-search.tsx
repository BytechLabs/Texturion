"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  canSeeSettingsSection,
  searchSettings,
  settingsGroupOf,
  type SettingsSearchResult,
} from "@loonext/shared";

import { GROUP_LABELS, settingsSectionOf } from "@/components/settings/settings-nav";
import { Input } from "@/components/ui/input";
import { useT, type MessageKey } from "@/i18n/provider";
import { useActiveCompany } from "@/lib/company/provider";

/** #719: tells the settings shell to scroll to a setting and mark it. */
export const SETTINGS_ANCHOR_EVENT = "loonext:settings-anchor";

/** What a search result needs to be drawn and opened. */
export interface SettingsHit {
  id: string;
  label: string;
  groupLabel: MessageKey;
  sectionLabel: MessageKey;
  href: string;
  anchor: string;
}

/**
 * The settings that match `query` for this viewer, from the one shared index.
 * A section the viewer's role cannot open is never searched.
 */
export function useSettingsHits(query: string): SettingsHit[] {
  const t = useT();
  const { role } = useActiveCompany();
  const locale = t.locale.startsWith("fr") ? "fr" : "en";
  return useMemo(
    () =>
      searchSettings(query, locale, (section) =>
        canSeeSettingsSection(section, role),
      ).flatMap((result: SettingsSearchResult) => {
        const section = settingsSectionOf(result.entry.section, result.entry.page);
        if (!section) return [];
        return [
          {
            id: result.entry.id,
            label: result.label,
            groupLabel: GROUP_LABELS[settingsGroupOf(result.entry.section)],
            sectionLabel: section.label,
            href: section.href ?? `/settings/${section.slug}`,
            anchor: result.entry.anchor,
          },
        ];
      }),
    [query, locale, role],
  );
}

/** Open a setting: its page at `#anchor`, then scroll to it and mark it. */
export function openSettingsHit(
  router: { push: (href: string) => void },
  hit: Pick<SettingsHit, "href" | "anchor">,
) {
  router.push(`${hit.href}#${hit.anchor}`);
  announceSettingsAnchor(hit.anchor);
}

/** For a link that navigates by itself: ask the shell to scroll and mark. */
export function announceSettingsAnchor(anchor: string) {
  window.dispatchEvent(
    new CustomEvent<string>(SETTINGS_ANCHOR_EVENT, { detail: anchor }),
  );
}

const MARK = [
  "ring-2",
  "ring-ring",
  "ring-offset-2",
  "ring-offset-background",
  "transition-shadow",
];
const MARK_MS = 2200;
const WAIT_MS = 8000;

/**
 * Scroll to `anchor` and ring it for a moment. The page may still be loading
 * its cards, so when the element is not there yet this waits for it. Returns
 * a function that stops everything.
 */
export function focusSettingsAnchor(anchor: string): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let observer: MutationObserver | null = null;
  let marked: HTMLElement | null = null;

  const apply = () => {
    const el = document.getElementById(anchor);
    if (!el) return false;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    el.classList.add(...MARK);
    marked = el;
    timers.push(setTimeout(() => el.classList.remove(...MARK), MARK_MS));
    return true;
  };

  if (!apply()) {
    observer = new MutationObserver(() => {
      if (apply()) observer?.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timers.push(setTimeout(() => observer?.disconnect(), WAIT_MS));
  }

  return () => {
    observer?.disconnect();
    timers.forEach(clearTimeout);
    marked?.classList.remove(...MARK);
  };
}

/**
 * Lives in the settings shell, which stays mounted across settings pages: it
 * answers a search result being opened, and a URL that arrives with `#anchor`.
 */
export function SettingsAnchorFocus() {
  const pathname = usePathname();
  useEffect(() => {
    let stop: (() => void) | undefined;
    const run = (anchor: string) => {
      stop?.();
      stop = focusSettingsAnchor(anchor);
    };
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash) run(decodeURIComponent(hash));
    };
    const onEvent = (event: Event) => run((event as CustomEvent<string>).detail);
    fromHash();
    window.addEventListener(SETTINGS_ANCHOR_EVENT, onEvent);
    window.addEventListener("hashchange", fromHash);
    return () => {
      stop?.();
      window.removeEventListener(SETTINGS_ANCHOR_EVENT, onEvent);
      window.removeEventListener("hashchange", fromHash);
    };
  }, [pathname]);
  return null;
}

/**
 * The search field at the top of the settings navigation. While it holds a
 * query the matching settings replace `children` (the grouped section list);
 * clearing it brings the groups back.
 */
export function SettingsSearchPanel({ children }: { children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = useSettingsHits(query);
  const searching = query.trim().length > 0;

  function open(hit: SettingsHit) {
    setQuery("");
    openSettingsHit(router, hit);
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            } else if (event.key === "ArrowDown" && hits.length > 0) {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            } else if (event.key === "ArrowUp" && hits.length > 0) {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              const hit = hits[active];
              if (hit) {
                event.preventDefault();
                open(hit);
              }
            }
          }}
          placeholder={t("settingsMore.settingsSearchPlaceholder")}
          aria-label={t("settingsMore.settingsSearchLabel")}
          autoComplete="off"
          className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("settingsMore.settingsSearchClear")}
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>

      {!searching ? (
        children
      ) : hits.length === 0 ? (
        <p role="status" className="px-1 text-sm text-muted-foreground">
          {t("settingsMore.settingsSearchNone", { query: query.trim() })}
        </p>
      ) : (
        <ul
          aria-label={t("settingsMore.settingsSearchResultsAria")}
          className="divide-y rounded-lg border bg-card"
        >
          {hits.map((hit, index) => (
            <li key={hit.id}>
              <Link
                href={`${hit.href}#${hit.anchor}`}
                onClick={() => {
                  setQuery("");
                  announceSettingsAnchor(hit.anchor);
                }}
                aria-current={index === active ? "true" : undefined}
                className={
                  "block min-h-[44px] px-3 py-2 transition-colors duration-150 ease-out hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (index === active ? "bg-accent/60" : "")
                }
              >
                <span className="block text-sm font-medium">{hit.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("settingsMore.settingsSearchPath", {
                    group: t(hit.groupLabel),
                    section: t(hit.sectionLabel),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
