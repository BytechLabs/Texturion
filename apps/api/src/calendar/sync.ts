/**
 * Provider-neutral calendar conflict resolution for D137 / #245.
 *
 * Provider timestamps are deliberately absent. Google `updated` and Graph
 * `lastModifiedDateTime` say when a server accepted a write, not when a person
 * decided to move a job. The only safe comparison is a three-way diff between
 * our current scheduling fields, their current scheduling fields, and the
 * last field values both sides agreed on.
 */

/** The scheduling fields that participate in conflict detection. */
export interface CalendarScheduleSnapshot {
  /** Canonical UTC instant. */
  start: string;
  /** Canonical UTC instant. */
  end: string;
  /** IANA time-zone identifier used to render the wall clock. */
  timeZone: string;
  title: string;
  /** Hash only: provider descriptions can contain customer information. */
  descriptionHash: string;
}

/** A normalized provider observation at the calendar boundary. */
export type CalendarInbound =
  | { kind: "scheduled"; schedule: CalendarScheduleSnapshot }
  | { kind: "removed" }
  | { kind: "all_day" }
  | { kind: "zone_refused"; providerZone: string }
  | { kind: "title_refused"; reason: "empty" | "too_long" }
  | { kind: "description_refused"; reason: "too_long" }
  | { kind: "recurrence_refused" }
  | { kind: "time_refused"; reason: "invalid_time" | "invalid_range" };

export interface ResolveCalendarSyncInput {
  /** Last scheduling values known to be agreed on by both sides. */
  base: CalendarScheduleSnapshot | null;
  /** Current task values, built at decision time rather than queue time. */
  ours: CalendarScheduleSnapshot;
  /** Current provider observation. */
  inbound: CalendarInbound;
  /**
   * Exact scheduling values of our most recent provider write.
   *
   * A matching inbound event is our echo even if its provider version differs.
   * If the task moved again after that write, the new task values are pushed;
   * the echo must never pull the older values back into the task.
   */
  lastSent?: CalendarScheduleSnapshot | null;
}

export type CalendarSyncDecision =
  | {
      kind: "noop";
      reason: "unchanged" | "already_equal" | "echo";
      agreed: CalendarScheduleSnapshot;
    }
  | {
      kind: "push_ours";
      reason: "only_ours_changed" | "echo_superseded";
      schedule: CalendarScheduleSnapshot;
      /** Provider writes are never allowed without If-Match/changeKey. */
      requiresPrecondition: true;
    }
  | {
      kind: "apply_theirs";
      schedule: CalendarScheduleSnapshot;
      /** A confirmation promises a particular time and cannot survive a move. */
      clearConfirmation: true;
    }
  | {
      kind: "conflict";
      reason: "both_changed" | "missing_base";
      base: CalendarScheduleSnapshot | null;
      ours: CalendarScheduleSnapshot;
      theirs: CalendarScheduleSnapshot;
    }
  | {
      kind: "event_removed";
      /** Phase one asks what happened; it never deletes the task. */
      keepTask: true;
      clearDueAt: true;
      remindersEligible: false;
    }
  | {
      kind: "all_day_refused";
      /** There is no honest instant to invent for an all-day event. */
      clearMirror: true;
      remindersEligible: false;
    }
  | {
      kind: "zone_refused";
      providerZone: string;
      /** An unknown Windows/provider zone must never fall back to UTC. */
      remindersEligible: false;
    }
  | {
      kind: "title_refused";
      reason: "empty" | "too_long";
      /** An invalid provider title cannot enter the canonical snapshot. */
      remindersEligible: false;
    }
  | {
      kind: "time_refused";
      reason: "invalid_time" | "invalid_range";
      /** A malformed provider wall clock cannot become a task instant. */
      remindersEligible: false;
    }
  | {
      kind: "description_refused";
      reason: "too_long";
      /** Provider text above the task limit is never silently truncated. */
      remindersEligible: false;
    }
  | {
      kind: "recurrence_refused";
      /** A series master is not one unambiguous appointment occurrence. */
      remindersEligible: false;
    };

/** Exact equality over the complete D137 scheduling snapshot. */
export function sameCalendarSchedule(
  left: CalendarScheduleSnapshot,
  right: CalendarScheduleSnapshot,
): boolean {
  return (
    left.start === right.start &&
    left.end === right.end &&
    left.timeZone === right.timeZone &&
    left.title === right.title &&
    left.descriptionHash === right.descriptionHash
  );
}

/**
 * Decide one inbound observation without reading clocks or provider versions.
 *
 * Callers persist the returned agreed snapshot only after the corresponding
 * local/provider write succeeds. A 409/412 from a provider means re-read and
 * call this function again; it never means replay the stale body.
 */
export function resolveCalendarSync(
  input: ResolveCalendarSyncInput,
): CalendarSyncDecision {
  if (input.inbound.kind === "removed") {
    return {
      kind: "event_removed",
      keepTask: true,
      clearDueAt: true,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "all_day") {
    return {
      kind: "all_day_refused",
      clearMirror: true,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "zone_refused") {
    return {
      kind: "zone_refused",
      providerZone: input.inbound.providerZone,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "title_refused") {
    return {
      kind: "title_refused",
      reason: input.inbound.reason,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "time_refused") {
    return {
      kind: "time_refused",
      reason: input.inbound.reason,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "description_refused") {
    return {
      kind: "description_refused",
      reason: input.inbound.reason,
      remindersEligible: false,
    };
  }
  if (input.inbound.kind === "recurrence_refused") {
    return {
      kind: "recurrence_refused",
      remindersEligible: false,
    };
  }

  const theirs = input.inbound.schedule;

  // A value match, not an etag match, is the echo proof. The task may have
  // moved again while the provider notification was in flight; in that case
  // push the current row rather than pulling the echo back over it.
  if (input.lastSent && sameCalendarSchedule(theirs, input.lastSent)) {
    if (sameCalendarSchedule(input.ours, input.lastSent)) {
      return { kind: "noop", reason: "echo", agreed: theirs };
    }
    return {
      kind: "push_ours",
      reason: "echo_superseded",
      schedule: input.ours,
      requiresPrecondition: true,
    };
  }

  if (!input.base) {
    if (sameCalendarSchedule(input.ours, theirs)) {
      return { kind: "noop", reason: "already_equal", agreed: theirs };
    }
    // With no common ancestor, choosing either side would be a timestamp rule
    // in disguise. Initial outbound creation is a separate, explicit action.
    return {
      kind: "conflict",
      reason: "missing_base",
      base: null,
      ours: input.ours,
      theirs,
    };
  }

  const oursChanged = !sameCalendarSchedule(input.ours, input.base);
  const theirsChanged = !sameCalendarSchedule(theirs, input.base);

  if (!oursChanged && !theirsChanged) {
    return { kind: "noop", reason: "unchanged", agreed: input.base };
  }
  if (oursChanged && !theirsChanged) {
    return {
      kind: "push_ours",
      reason: "only_ours_changed",
      schedule: input.ours,
      requiresPrecondition: true,
    };
  }
  if (!oursChanged && theirsChanged) {
    return {
      kind: "apply_theirs",
      schedule: theirs,
      clearConfirmation: true,
    };
  }
  if (sameCalendarSchedule(input.ours, theirs)) {
    return { kind: "noop", reason: "already_equal", agreed: theirs };
  }

  return {
    kind: "conflict",
    reason: "both_changed",
    base: input.base,
    ours: input.ours,
    theirs,
  };
}
