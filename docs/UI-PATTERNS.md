# UI patterns

**Status: CURRENT DIRECTION (#733).** Describes how each pattern is drawn today and which ones are still open. Where it disagrees with `docs/DECISIONS.md`, that file wins.

One job, drawn one way, on every screen and every client (#733). Each pattern
below has one component per client and a guard that fails when a screen draws
the pattern by hand. A pattern marked **open** still has hand-rolled copies,
listed with where they are.

The web inventory was taken on 2026-11-11 across `apps/web/src` (marketing and
the public job-photo page keep their own type scale and are out of scope).

## Patterns

| Pattern | Web | Android | iOS | Guard | Status |
|---|---|---|---|---|---|
| Section label (small uppercase heading over a group, column or list) | `SECTION_LABEL_CLASS` / `SectionLabel` in `apps/web/src/components/ui/section-label.tsx` | `SectionHeadingStyle` (`ui/common/Ds.kt`) | `SectionHeadingStyle` (`Theme/DesignSystem.swift`) | `section-label.test.ts` | done on web: 23 labels in 22 files moved onto one class |
| Page header (title, main action, secondary actions) | `PageHeader` in `apps/web/src/components/ui/page-header.tsx` | `MainActionButton` (`ui/common/MainAction.kt`) | `.mainAction(...)` (`Theme/MainAction.swift`) | `page-header.test.ts`, `MainActionWiringTest(s)` | done on web: every in-app page title, with its one-line description, goes through `PageHeader`; record pages title themselves in their record header |
| One filled primary per view | `PageHeader`'s `primary` slot | the main action button | the main action button | `page-header.test.ts` | done on web: New contact moved into the primary slot, and the Contacts and Inbox empty-state actions are outline |
| Empty state | `EmptyState` in `apps/web/src/components/ui/empty-state.tsx`, `page` or `panel` | none yet | none yet | `empty-state.test.ts` | done on web: tasks, history, trash, attachments, map, search, the thread pane, For you's caught-up card and the error boundary moved onto it |
| Load error | `LoadError` in `apps/web/src/components/ui/load-error.tsx`, `card` or `fill`, outline Retry | | | `empty-state.test.ts` catches the centred shape | done on web for the inbox list, search, For you, the task and thread panes and the gallery; the settings copy is gone and its 31 users import the shared one. Inline sentence-and-link retries inside cards (response time, satisfaction, attachments, the bell) are still open |
| List loading skeleton | none | | | none yet | **open**: a dozen inline skeletons of different row shapes |
| Confirm dialog (destructive) | `ConfirmDialog` in `apps/web/src/components/ui/confirm-dialog.tsx`, always `sm:max-w-sm`, Cancel outline, `tone` destructive or default, `children` for a typed-word field | | | `confirm-dialog.test.ts` fails on a hand-built cancel + destructive `DialogFooter` | done on web for every destructive yes/no and the typed Delete forever and Release number. Still open: the form and code-entry dialogs keep their own footers (named in the guard), and the non-destructive confirms (leave workspace, require 2FA, unmerge, claim ownership, plan modules, US registration) are still hand-built because the guard only sees `variant="destructive"` |
| Search field | `SearchField` in `apps/web/src/components/ui/search-field.tsx` | | | `search-field.test.ts` | done on web: inbox, tasks, contacts and settings share one box with a clear button |
| Segmented control | none; inbox and calls share a copied shape | | | none yet | **open**: tasks, calendar and the measure cards use three other shapes and three ARIA patterns |
| Count pill | `Badge` for status; no count pill | | | none yet | **open**: six class strings |
| Record menu | `RecordMenu` / `RecordOverflowMenu` (#712) | `RecordMenu.kt` | `RecordMenu.swift` | `record-actions.test.tsx`, `RecordActionsTest(s)` | done |
| Record header | `RecordHeader` (#717) | | | | done on web |
| Dates | `Timestamp` / `formatTimestamp` (#720) | `Timestamp` | `Timestamp` | `timestamp-guard.test.ts`, `TimestampGuardTest(s)` | done |
| Filter row | `ListFilterHeader` (#711) | `ListFilterHeader.kt` | `ListFilterHeader.swift` | | done |
| Activity timeline | `ActivityTimeline` (#714) | `ActivityTimeline.kt` | `ActivityTimelineView.swift` | `activity-line.test.ts`, `ActivityLineTest(s)` | done |
| Icon size | three sizes: 14px (`size-3.5`), 16px (`size-4`), 20px (`size-5`); stroke 1.75 | | | `icon-size.test.ts` | done on web: the sidebar, the bell and the composer moved onto the three sizes, stroke 1.75 |
| Toasts | `undoableToast` for anything reversible, `createdToast` for something made elsewhere, plain success or error otherwise | | | none yet | **open**: contact and template deletes report with no Undo |

## Rules that hold everywhere

- A label over a group is a section label, not a heading of its own size.
- A page has one filled button, its main action, at the trailing end of the
  header. Empty-state actions are outline.
- A chip is a filled, rounded token; a section label is never a chip.
- Every user-facing string comes from the catalogue, in English and French.
