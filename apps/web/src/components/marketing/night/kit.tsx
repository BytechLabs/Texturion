/**
 * "Quiet daylight" (v3) — the shared demo-UI kit (v3 spec §5).
 *
 * Faithful, marketing-scale recreations of the real product UI, styled LIGHT:
 * white card surfaces, one hairline, quiet tints, petrol accents. Rendered as
 * pure server markup (living DOM, never a screenshot or a bezel). Product-UI
 * radii are the app's real ones: 12px bubbles/cards, 999px pills/avatars,
 * 8px composer.
 *
 * Motion is NOT baked in here. Every component renders its finished, resolved
 * state; the only moving parts are the four sanctioned movements in
 * night-css.tsx (land, ticks, unread double-pulse, odometer roll), opted into
 * via [data-anim] islands or the standard <Reveal> mechanism. <NightCss />
 * must be mounted once on the page for the nx- classes to exist.
 *
 * LEGACY PROPS (kept so section files keep compiling, but INERT in v3):
 *   - InBubble `lit`, OutBubble `glow` — powered the deleted lamp glows.
 *   - Composer `caretBlink` — the caret repeater is gone.
 * They are accepted and ignored; passing them changes nothing.
 *
 * Nothing in this kit is interactive: recreated buttons/checkboxes are spans,
 * so the demo adds no tab stops and no false affordances for AT. Real CTAs
 * (e.g. the S7 composer button) come in through slots owned by the sections.
 */

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------- *
 * Shared prop plumbing: className + data-* / style passthrough so section
 * builders can wire triggers without the kit knowing about them.
 * ------------------------------------------------------------------------- */
type NightRest = React.HTMLAttributes<HTMLElement> & {
  [attr: `data-${string}`]: string | number | boolean | undefined;
};

type AsProp = { as?: React.ElementType };

/* ------------------------------------------------------------------------- *
 * NightShell — the app-shell recreation, now a clean white master-detail
 * card: white surface, hairline dividers between panes, nothing heavier.
 * ------------------------------------------------------------------------- */

export type SidebarItem = "Inbox" | "Contacts" | "Templates" | "Tasks" | "Settings";

const SIDEBAR_ITEMS: SidebarItem[] = ["Inbox", "Contacts", "Templates", "Tasks", "Settings"];

/* Tiny inline-SVG glyphs, 1.5px strokes with rounded caps, currentColor.
   Decorative: the visible label carries meaning. */
const GLYPH_PATHS: Record<SidebarItem, React.ReactNode> = {
  Inbox: (
    <>
      <path d="M2.5 9.5 4.6 4.1a1 1 0 0 1 .93-.6h4.94a1 1 0 0 1 .93.6l2.1 5.4" />
      <path d="M2.5 9.5V12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
      <path d="M2.5 9.5h3.2l1 1.5h2.6l1-1.5h3.2" />
    </>
  ),
  Contacts: (
    <>
      <circle cx="8" cy="5.4" r="2.4" />
      <path d="M3.6 13.2c.8-2.5 2.4-3.7 4.4-3.7s3.6 1.2 4.4 3.7" />
    </>
  ),
  Templates: (
    <>
      <rect x="3.5" y="2.5" width="9" height="11" rx="1.2" />
      <path d="M6 6h4.5M6 8.5h4.5M6 11h2.8" />
    </>
  ),
  Tasks: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
      <path d="m5.6 8.2 1.7 1.7 3.3-3.7" />
    </>
  ),
  Settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 2.6v1.6M8 11.8v1.6M2.6 8h1.6M11.8 8h1.6M4.2 4.2l1.1 1.1M10.7 10.7l1.1 1.1M11.8 4.2l-1.1 1.1M5.3 10.7l-1.1 1.1" />
    </>
  ),
};

function NavGlyph({ item, className }: { item: SidebarItem; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0", className)}
    >
      {GLYPH_PATHS[item]}
    </svg>
  );
}

export function NightShell({
  active = "Inbox",
  ariaLabel,
  sidebar = true,
  list,
  thread,
  composer,
  sidebarExtra,
  threadExtra,
  listLabel = "Conversations",
  threadLabel = "Conversation",
  listClassName,
  threadClassName,
  className,
  ...rest
}: {
  /** Which sidebar item reads as selected. */
  active?: SidebarItem;
  /** Required: the shell is an aria-labelled region. */
  ariaLabel: string;
  /** Hide the sidebar entirely (the hero's two-pane master-detail). */
  sidebar?: boolean;
  /** <ConvRow> items — rendered inside a real <ul>. Omit for thread-only. */
  list?: React.ReactNode;
  /** Thread items (<InBubble>/<OutBubble>/<NoteRow>/<SystemLine>/...) —
   *  rendered inside a real <ul>, so leave their default as="li". */
  thread?: React.ReactNode;
  /** Composer slot, docked under the thread. */
  composer?: React.ReactNode;
  /** Legacy overlay slot inside the sidebar (still rendered; the glow layers
   *  it used to carry are gone, so most sections should omit it). */
  sidebarExtra?: React.ReactNode;
  /** Legacy overlay slot inside the thread pane (same note as sidebarExtra). */
  threadExtra?: React.ReactNode;
  listLabel?: string;
  threadLabel?: string;
  listClassName?: string;
  threadClassName?: string;
} & NightRest) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "panel-card font-body-mkt grid overflow-hidden rounded-xl text-left text-sm leading-[1.45] text-[color:var(--day-ink)]",
        "grid-cols-[minmax(0,1fr)]",
        list ? "sm:grid-cols-[minmax(12rem,14rem)_minmax(0,1fr)]" : undefined,
        sidebar && list
          ? "lg:grid-cols-[9.5rem_minmax(12rem,14rem)_minmax(0,1fr)]"
          : undefined,
        sidebar && !list ? "lg:grid-cols-[9.5rem_minmax(0,1fr)]" : undefined,
        className,
      )}
      {...rest}
    >
      {sidebar ? (
        <aside className="relative hidden border-r border-[color:var(--rule-light)] p-2.5 lg:block">
          <ul className="grid gap-1">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive = item === active;
              return (
                <li key={item}>
                  <span
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.8125rem]",
                      isActive
                        ? "bg-[color:var(--petrol-12)] font-medium text-[color:var(--petrol)]"
                        : "text-[color:var(--ink-55)]",
                    )}
                  >
                    <NavGlyph item={item} />
                    {item}
                  </span>
                </li>
              );
            })}
          </ul>
          {sidebarExtra}
        </aside>
      ) : null}

      {list ? (
        <div
          className={cn(
            "hidden border-r border-[color:var(--rule-light)] sm:block",
            listClassName,
          )}
        >
          {/* grid-cols-1 is load-bearing: without a column template the
              implicit `auto` track sizes to the rows' max-content, so the
              untruncated snippets stretch every row past the fixed list track
              and paint across the thread pane. minmax(0,1fr) caps the track at
              the pane width, which is what lets the rows' min-w-0 truncation
              actually engage. */}
          <ul aria-label={listLabel} className="grid grid-cols-1 gap-px p-1.5">
            {list}
          </ul>
        </div>
      ) : null}

      <div className={cn("relative flex min-w-0 flex-col", threadClassName)}>
        {threadExtra}
        <ul aria-label={threadLabel} className="flex flex-1 flex-col gap-2.5 p-4 sm:p-5">
          {thread}
        </ul>
        {composer ? (
          <div className="border-t border-[color:var(--rule-light)] p-2.5 sm:p-3">
            {composer}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- *
 * Conversation-list pieces
 * ------------------------------------------------------------------------- */

/** Amber unread dot — the page's ONLY amber. Resolved: steady; under an armed
 *  [data-anim] ancestor (the hero) it double-pulses then holds (nx-unread). */
export function UnreadDot({ className, ...rest }: NightRest) {
  return (
    <span className={cn("relative inline-flex", className)} {...rest}>
      <span
        aria-hidden="true"
        className="nx-unread inline-block size-2 rounded-full bg-[color:var(--porch-amber)]"
      />
      <span className="sr-only">Unread</span>
    </span>
  );
}

/** Assignee avatar initial: petrol circle, the app's 999px avatar radius. */
export function AvatarDot({
  initial,
  className,
  ...rest
}: { initial: string } & NightRest) {
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--petrol)] text-[0.625rem] font-semibold leading-none text-white",
        className,
      )}
      {...rest}
    >
      {initial}
    </span>
  );
}

export type PillStatus = "New" | "Open" | "Waiting" | "Closed";

/* Quiet tints only (v3 spec §5): New/Open live in the petrol family,
   Waiting/Closed in the neutral family. No solid loud fills. */
const PILL_LOOK: Record<PillStatus, string> = {
  New: "bg-[color:var(--petrol-12)] text-[color:var(--petrol)]",
  Open: "bg-[color:var(--petrol-12)] text-[color:var(--petrol)]",
  Waiting: "bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-55)]",
  Closed: "bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-55)]",
};

export function StatusPill({
  status,
  className,
  ...rest
}: { status: PillStatus } & NightRest) {
  return (
    <span
      className={cn(
        "font-body-mkt inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-4",
        PILL_LOOK[status],
        className,
      )}
      {...rest}
    >
      {status}
    </span>
  );
}

/** Tag chip; tone "won" is the money copper (copper text on a 10% copper
 *  tint — one of copper's three sanctioned uses). */
export function TagChip({
  tone = "default",
  className,
  children,
  ...rest
}: { tone?: "default" | "won" } & NightRest) {
  return (
    <span
      className={cn(
        "font-body-mkt inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium leading-4",
        tone === "won"
          ? "bg-[rgba(154,79,38,0.1)] text-[color:var(--copper)]"
          : "bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-70)]",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Conversation-list row. Defaults to <li> for NightShell's real <ul>; pass
 *  as="div" when docking it standalone (the S2 proof fragments). */
export function ConvRow({
  name,
  snippet,
  time,
  unread = false,
  pill,
  avatar,
  active = false,
  as: Tag = "li",
  className,
  ...rest
}: {
  name: string;
  snippet: string;
  time: string;
  unread?: boolean;
  pill?: PillStatus;
  avatar?: string;
  active?: boolean;
} & AsProp &
  NightRest) {
  return (
    <Tag
      className={cn(
        "flex flex-col gap-1 rounded-lg px-2.5 py-2",
        active ? "bg-[#F0F4F2]" : undefined,
        className,
      )}
      {...rest}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[0.8125rem] font-semibold text-[color:var(--day-ink)]">
          {name}
        </span>
        <span className="font-mono-mkt shrink-0 text-[0.6875rem] text-[color:var(--ink-55)]">
          {time}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-[color:var(--ink-55)]">{snippet}</span>
        {unread ? <UnreadDot className="shrink-0" /> : null}
      </span>
      {pill || avatar ? (
        <span className="mt-0.5 flex items-center justify-between gap-2">
          {pill ? <StatusPill status={pill} /> : <span aria-hidden="true" />}
          {avatar ? <AvatarDot initial={avatar} /> : null}
        </span>
      ) : null}
    </Tag>
  );
}

/* ------------------------------------------------------------------------- *
 * Thread pieces
 * ------------------------------------------------------------------------- */

/** Inbound bubble: #F0F4F2 fill, --day-ink text, the app's 12px radius.
 *  `lit` is a legacy glow prop — accepted, INERT (no glow exists in v3). */
export function InBubble({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- inert legacy prop (v3): accepted, ignored
  lit: _lit = true,
  as: Tag = "li",
  className,
  children,
  ...rest
}: { lit?: boolean } & AsProp & NightRest) {
  return (
    <Tag
      className={cn(
        "max-w-[85%] self-start rounded-xl bg-[#F0F4F2] px-3.5 py-2.5 text-sm leading-[1.45] text-[color:var(--day-ink)]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* Delivery checkmarks, drawn (font-independent), petrol via currentColor. */
function Checks({ double = false }: { double?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block h-[0.6em] w-auto"
    >
      <path d="m1.5 5.2 2.5 2.5L8.6 3" />
      {double ? <path d="m8.2 7.4.6.6L13.4 3.4" /> : null}
    </svg>
  );
}

/** Delivery-tick meta: queued -> sent -> delivered, petrol, Martian Mono.
 *  Resolved shows Delivered; it steps once under an armed [data-anim]
 *  ancestor OR a revealed <Reveal> wrapper ([data-revealed="true"]), offset
 *  by --nx-tick-delay set on the bubble/ancestor. Transient states are
 *  aria-hidden so AT only ever hears the final one. */
export function TickMeta({ className, ...rest }: NightRest) {
  return (
    <span
      className={cn(
        "nx-tick font-mono-mkt text-[0.6875rem] tracking-[0.02em] text-[color:var(--petrol)]",
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="nx-tick-q">
        Queued …
      </span>
      <span aria-hidden="true" className="nx-tick-s">
        Sent <Checks />
      </span>
      <span className="nx-tick-d">
        Delivered <Checks double />
      </span>
    </span>
  );
}

/** Outbound bubble: petrol fill, white text, right-aligned, TickMeta
 *  underneath. `glow` is a legacy prop — accepted, INERT. */
export function OutBubble({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- inert legacy prop (v3): accepted, ignored
  glow: _glow = true,
  ticks = true,
  as: Tag = "li",
  className,
  children,
  ...rest
}: {
  glow?: boolean;
  ticks?: boolean;
} & AsProp &
  NightRest) {
  return (
    <Tag
      className={cn("flex max-w-[85%] flex-col items-end gap-1 self-end", className)}
      {...rest}
    >
      <span className="block rounded-xl bg-[color:var(--petrol)] px-3.5 py-2.5 text-left text-sm leading-[1.45] text-white">
        {children}
      </span>
      {ticks ? <TickMeta /> : null}
    </Tag>
  );
}

/** Muted team-note row: white, dashed hairline, --ink-55 — the
 *  customer-invisible register. Renders the product's "Note · Marcus: ..."
 *  pattern. */
export function NoteRow({
  author,
  as: Tag = "li",
  className,
  children,
  ...rest
}: { author: string } & AsProp & NightRest) {
  return (
    <Tag
      className={cn(
        "max-w-[85%] self-start rounded-lg border border-dashed border-[color:var(--rule-light)] bg-white px-3 py-2 text-[0.8125rem] leading-[1.45] text-[color:var(--ink-55)]",
        className,
      )}
      {...rest}
    >
      <span className="font-semibold">Note · {author}:</span> {children}
    </Tag>
  );
}

/** Centered muted system line ("Assigned to Marcus", "Tagged 'Quote sent'").
 *  Body face (v3 §3: mono is for figures, not captions). */
export function SystemLine({
  as: Tag = "li",
  className,
  children,
  ...rest
}: AsProp & NightRest) {
  return (
    <Tag
      className={cn(
        "font-body-mkt self-center text-center text-xs text-[color:var(--ink-55)]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** The promoted-task card: circle-check, title, mono meta line
 *  "Task · {assignee} · due {due}". done = petrol check + line-through. */
export function TaskCardMini({
  title,
  assignee,
  due,
  done = false,
  as: Tag = "div",
  className,
  ...rest
}: {
  title: string;
  assignee: string;
  due: string;
  done?: boolean;
} & AsProp &
  NightRest) {
  return (
    <Tag
      className={cn(
        "max-w-sm rounded-xl border border-[rgba(11,43,38,0.08)] bg-white px-3.5 py-3",
        className,
      )}
      {...rest}
    >
      <span className="flex items-start gap-2.5">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            done ? "text-[color:var(--petrol)]" : "text-[color:var(--ink-55)]",
          )}
        >
          <circle cx="8" cy="8" r="5.6" />
          {done ? <path d="m5.6 8.2 1.7 1.7 3.2-3.6" /> : null}
        </svg>
        <span className="min-w-0">
          <span
            className={cn(
              "block text-sm font-semibold text-[color:var(--day-ink)]",
              done ? "line-through [text-decoration-color:var(--ink-55)]" : undefined,
            )}
          >
            {title}
          </span>
          <span className="font-mono-mkt mt-1 block text-[0.6875rem] tracking-[0.02em] text-[color:var(--ink-55)]">
            Task · {assignee} · due {due}
          </span>
          {done ? <span className="sr-only">Done</span> : null}
        </span>
      </span>
    </Tag>
  );
}

/* ------------------------------------------------------------------------- *
 * Guardrail fragments (quiet hours + consent) — copy-deck verbatim UI truth
 * ------------------------------------------------------------------------- */

/** The quiet-hours dialog, recreated as a static panel (no <dialog>, no tab
 *  stops): white, hairline, one soft shadow, petrol primary button. Copy is
 *  the product's literal string; buttons are pictures. */
export function QuietHoursDialog({
  as: Tag = "div",
  className,
  ...rest
}: AsProp & NightRest) {
  return (
    <Tag
      className={cn(
        "font-body-mkt max-w-xs rounded-xl border border-[rgba(11,43,38,0.08)] bg-white p-4 shadow-[0_4px_12px_rgba(11,43,38,0.08)]",
        className,
      )}
      {...rest}
    >
      <span className="flex items-start gap-2.5">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-[color:var(--ink-55)]"
        >
          <path d="M13.2 9.7A5.6 5.6 0 0 1 6.3 2.8a5.6 5.6 0 1 0 6.9 6.9z" />
        </svg>
        <span className="min-w-0 text-sm leading-[1.45]">
          <span className="block font-semibold text-[color:var(--day-ink)]">
            It’s 9:47 PM where this customer is.
          </span>
          <span className="mt-0.5 block text-[color:var(--ink-70)]">Send anyway?</span>
        </span>
      </span>
      <span className="mt-3.5 flex justify-end gap-2">
        <span className="rounded-lg bg-[color:var(--petrol)] px-3 py-1.5 text-[0.8125rem] font-semibold text-white">
          Send anyway
        </span>
        <span className="rounded-lg border border-[color:var(--rule-light)] px-3 py-1.5 text-[0.8125rem] font-medium text-[color:var(--ink-70)]">
          Cancel
        </span>
      </span>
    </Tag>
  );
}

/** The consent checkbox fragment, checked state, verbatim label. Static
 *  recreation (no real input: it is a picture of the product, not a form). */
export function ConsentRow({ as: Tag = "div", className, ...rest }: AsProp & NightRest) {
  return (
    <Tag className={cn("font-body-mkt flex items-center gap-2.5", className)} {...rest}>
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-[color:var(--petrol)]"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3 text-white"
        >
          <path d="m2.5 6.3 2.2 2.2 4.8-5" />
        </svg>
      </span>
      <span className="text-sm leading-[1.45] text-[color:var(--day-ink)]">
        This customer asked us to text them
      </span>
    </Tag>
  );
}

/* ------------------------------------------------------------------------- *
 * Composer + usage
 * ------------------------------------------------------------------------- */

/** The composer bar: white input, one hairline, the app's real 8px radius,
 *  petrol send. Static by default; the S7 CTA passes a real link through
 *  `button`. children = typed content; otherwise the placeholder shows in
 *  --ink-55. `caretBlink` is a legacy prop — accepted, INERT (the caret
 *  repeater is gone in v3). */
export function Composer({
  placeholder,
  button,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- inert legacy prop (v3): accepted, ignored
  caretBlink: _caretBlink = false,
  className,
  children,
  ...rest
}: {
  placeholder: string;
  /** Replace the static send glyph with a real interactive element (S7). */
  button?: React.ReactNode;
  /** Legacy caret prop — accepted, ignored. */
  caretBlink?: boolean;
} & NightRest) {
  return (
    <div
      className={cn(
        "font-body-mkt flex items-end gap-2 rounded-lg border border-[color:var(--rule-light)] bg-white p-2",
        className,
      )}
      {...rest}
    >
      <span className="block min-h-[2.6rem] min-w-0 flex-1 px-1.5 py-1 text-sm leading-[1.45]">
        {children != null ? (
          <span className="text-[color:var(--day-ink)]">{children}</span>
        ) : (
          <span className="text-[color:var(--ink-55)]">{placeholder}</span>
        )}
      </span>
      {button ?? (
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-[color:var(--petrol)] text-white"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <path d="M13.5 2.5 7 9" />
            <path d="M13.5 2.5 9.2 13.5 7 9 2.5 6.8z" />
          </svg>
        </span>
      )}
    </div>
  );
}

/** The usage counters block (copy-deck verbatim): Included 500 / Used 132 /
 *  Overage 0 in Martian Mono over hairline rules. The figures are
 *  RollNumbers, so an armed [data-anim] ancestor makes them roll; left
 *  static, they sit seated. */
export function UsageMeter({ as: Tag = "div", className, ...rest }: AsProp & NightRest) {
  return (
    <Tag
      className={cn(
        "font-body-mkt rounded-xl border border-[rgba(11,43,38,0.08)] bg-white p-4",
        className,
      )}
      {...rest}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-[color:var(--day-ink)]">
          Usage this month
        </span>
        <span className="font-mono-mkt text-[0.6875rem] tracking-[0.02em] text-[color:var(--ink-55)]">
          Outbound segments
        </span>
      </span>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {(
          [
            ["Included", "500"],
            ["Used", "132"],
            ["Overage", "0"],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="font-mono-mkt text-[0.6875rem] tracking-[0.02em] text-[color:var(--ink-55)]">
              {label}
            </dt>
            <dd className="font-mono-mkt mt-1 text-xl leading-none text-[color:var(--day-ink)]">
              <RollNumber text={value} />
            </dd>
          </div>
        ))}
      </dl>
      <span className="font-mono-mkt mt-3 block border-t border-[color:var(--rule-light)] pt-2.5 text-[0.6875rem] tracking-[0.02em] text-[color:var(--ink-55)]">
        Inbound · free, not counted
      </span>
    </Tag>
  );
}

/* ------------------------------------------------------------------------- *
 * Motion helpers
 * ------------------------------------------------------------------------- */

/** LEGACY (v3): the TYPE movement is deleted; this now renders the full text
 *  statically. Kept only so section files keep compiling — prefer a plain
 *  string in new markup. */
export function TypeText({ text, className, ...rest }: { text: string } & NightRest) {
  return (
    <span className={className} {...rest}>
      {text}
    </span>
  );
}

/** ROLL helper: renders a figure string as odometer digit windows (digits
 *  1-9 get a 0..n strip pre-seated on n; 0 and punctuation stay static), with
 *  an sr-only label and aria-hidden visuals (the odometer carries a static
 *  accessible name). Resolved = seated; it rolls once under an armed
 *  [data-anim] ancestor (the S7 odometer island); total run stays <= 1.2s via
 *  --nx-roll-ms (default 900ms). `stagger` offsets each rolling digit. */
export function RollNumber({
  text,
  label,
  stagger = 0,
  digitClassName,
  className,
  ...rest
}: {
  text: string;
  /** Accessible name; defaults to the literal text. */
  label?: string;
  /** ms of --nx-delay per rolling digit (keep total <= 1.2s). */
  stagger?: number;
  digitClassName?: string;
} & NightRest) {
  let digitIndex = 0;
  return (
    <span className={cn("whitespace-nowrap leading-none", className)} {...rest}>
      <span className="sr-only">{label ?? text}</span>
      <span aria-hidden="true">
        {Array.from(text).map((ch, i) => {
          const rolls = ch >= "1" && ch <= "9" ? Number(ch) : null;
          if (rolls === null) {
            return (
              <span key={i} className={cn("nx-roll-c", digitClassName)}>
                {/* NBSP escape: a whitespace-only inline-block collapses to zero width. */}
                {ch === " " ? "\u00A0" : ch}
              </span>
            );
          }
          const delay = stagger
            ? { "--nx-delay": `${digitIndex * stagger}ms` }
            : undefined;
          digitIndex += 1;
          return (
            <span key={i} className={cn("nx-roll", digitClassName)}>
              <span
                className="nx-roll-strip"
                style={{ "--nx-steps": rolls, ...delay } as React.CSSProperties}
              >
                {Array.from({ length: rolls + 1 }, (_, k) => (
                  <span key={k} className="nx-roll-d">
                    {k}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
