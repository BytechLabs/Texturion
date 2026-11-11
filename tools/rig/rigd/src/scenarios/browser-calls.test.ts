import { readFileSync } from "node:fs";
import type { HearOptions } from "@loonext/rig-lanes";
import type { CallPlan, CallRecord, SegmentJudgement, Surface } from "@loonext/rig-robot";
import { describe, expect, it } from "vitest";
import { TENANTS } from "../../../../../scripts/rig/tenants.mjs";
import type { UndoAction } from "../lease.ts";
import {
  AFTER_COMPLETE_SEGMENT,
  CALL_WAITING_TEXT,
  COMPLETE_AT_MS,
  CONSULT_AT_MS,
  CONSULT_SEGMENT,
  consultDirection,
  ESCALATE_AFTER_MINUTES,
  hoursClosedAt,
  NUMBER_BUSY_TEXT,
  OWNER_RING_MS,
  RETURN_MS,
  S03,
  S05,
  S06,
  S06_SEGMENTS,
  S06_STEPS,
  S07,
  S07_VARIANTS,
  S08,
  S09,
  S10,
  S11,
  S11_RING_SECONDS,
  TECHNICIAN_NAME,
  TRANSFER_AT_MS,
  TRANSFER_RING_SECS,
  transferTimeline,
  type TransferVariant,
} from "./browser-calls.ts";
import type { AppApi, CallRow, MemberPageApi, ScenarioResult, ScenarioRunner } from "./context.ts";
import { fakeContext, type FakePageScript } from "./fakes.ts";

const OWNER = "qa-w-owner";
const TECH = "qa-w-technician";
const ROBOT_ANSWERED = Date.parse("2026-10-31T15:00:04.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Ten digits in a row, with spaces, dots, dashes or brackets allowed between them. */
const PHONE_DIGITS = /\+?\d(?:[\s().-]{0,2}\d){9,}/;
/** Random UUIDs can hold ten digits in a row, so they are removed before the check. */
const holdsPhoneNumber = (text: string) => PHONE_DIGITS.test(text.replace(UUID, "id"));

type World = ReturnType<typeof fakeContext>;
type Row = CallRow & { tenant: string; caller: string };

interface PageScript extends FakePageScript {
  /** Each waitForRing in turn, undefined for one that never rings; past the end, `ringsAfterMs`. */
  rings?: (number | undefined)[];
  marks?: { name: string; at: number }[];
  onDial?: (role: string) => void;
  /** Controls that throw, as the lane does when a control never shows. */
  broken?: string[];
}

interface PageLog {
  member: string;
  action: string;
  args: unknown[];
  at: number;
}

const PAGE: FakePageScript = { ringsAfterMs: 1_500, heard: null, energyBeforeAnswer: 0.4, showsText: true };
const LOGGED = ["answer", "decline", "hangUp", "dial", "hold", "mute", "pressKeys", "transfer", "completeTransfer", "mark", "waitForText"] as const;

interface Pages {
  scripts: Record<string, PageScript>;
  log: PageLog[];
  heard: { member: string; options?: HearOptions }[];
  did(member: string, action: string): PageLog[];
}
const installed = new WeakMap<World["browser"], Pages>();

/**
 * One fake page per member, each with its own script, and every call logged
 * with the fake clock's time. Called again on the same world, it replaces the
 * scripts for pages not opened yet.
 */
function withPages(world: World, scripts: Record<string, PageScript>): Pages {
  const existing = installed.get(world.browser);
  if (existing) {
    existing.scripts = scripts;
    return existing;
  }
  const log: PageLog[] = [];
  const pages: Pages = {
    scripts,
    log,
    heard: [],
    did: (member, action) => log.filter((entry) => entry.member === member && entry.action === action),
  };
  installed.set(world.browser, pages);
  const heard = pages.heard;
  const open = world.browser.open.bind(world.browser);
  world.browser.open = async (member, surface, path) => {
    const script = pages.scripts[member] ?? {};
    world.browser.script = { ...PAGE, ...script };
    const page = await open(member, surface, path);
    const rings = [...(script.rings ?? [])];
    const wrapped: MemberPageApi = {
      ...page,
      async waitForRing(timeoutMs) {
        log.push({ member, action: "waitForRing", args: [timeoutMs], at: world.time.now });
        if (rings.length === 0) return page.waitForRing(timeoutMs);
        const after = rings.shift();
        return after !== undefined && after <= timeoutMs ? after : undefined;
      },
      async dial(role) {
        await page.dial(role);
        script.onDial?.(role);
      },
      async hear(options) {
        heard.push({ member, options });
        const hearing = await page.hear(options);
        return script.marks ? { ...hearing, capture: { ...hearing.capture, marks: script.marks } } : hearing;
      },
    };
    const methods = wrapped as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const name of LOGGED) {
      const original = methods[name]!;
      methods[name] = async (...args: unknown[]) => {
        if (script.broken?.includes(name)) throw new Error(`browser lane: no ${name} control on the page`);
        log.push({ member, action: name, args, at: world.time.now });
        return original(...args);
      };
    }
    return wrapped;
  };
  return pages;
}

function row(tenant: string, caller: string, session: string, extra: Partial<CallRow> = {}): Row {
  return {
    tenant,
    caller,
    call_session_id: session,
    outcome: "answered",
    forward_seconds: 20,
    started_at: "2026-10-31T15:00:01.000Z",
    ended_at: "2026-10-31T15:00:40.000Z",
    voicemail_path: null,
    voicemail_transcript: null,
    voicemail_intake: null,
    ...extra,
  };
}

/** The probe files a row under its caller's number; a row the test removes from the list is gone from the app too. */
function withRows(world: World, rows: Row[]) {
  const app: AppApi = world.app;
  const calls = world.app.calls.bind(world.app);
  app.calls = async (args) => {
    world.app.callRows = rows.map((r) => Object.assign(r, { caller_role: r.caller }));
    return calls(args);
  };
  return rows;
}

/** What the lease held at each settings change and each shift insert. */
function withLeaseAtChanges(world: World) {
  type ShiftArgs = Parameters<AppApi["addOnCallShift"]>[0];
  const seen = { patches: [] as UndoAction[][], shifts: [] as { args: ShiftArgs; undo: UndoAction[] }[] };
  const app: AppApi = world.app;
  const patch = world.app.patchCompany.bind(world.app);
  app.patchCompany = async (args) => {
    seen.patches.push([...world.undo]);
    return patch(args);
  };
  const add = world.app.addOnCallShift.bind(world.app);
  app.addOnCallShift = async (args) => {
    seen.shifts.push({ args, undo: [...world.undo] });
    return add(args);
  };
  return seen;
}

function withSegments(record: Partial<CallRecord>, heard: Record<string, Surface[]>): Partial<CallRecord> {
  const segments: SegmentJudgement[] = Object.entries(heard).map(([name, surfaces]) => ({
    name,
    verdict: surfaces.length > 0 ? "heard" : "silent",
    heard: surfaces,
  }));
  return { ...record, judgement: record.judgement && { ...record.judgement, segments } };
}

function robotOutcome(world: World, edit: (record: Partial<CallRecord>, plan: CallPlan) => Partial<CallRecord>) {
  const base = world.robot.outcome;
  world.robot.outcome = (plan) => edit(base(plan), plan);
}

const deafRobot = (record: Partial<CallRecord>): Partial<CallRecord> => ({
  ...record,
  judgement: { ...record.judgement!, pass: false, verdict: "silent", answered: null, heard: [] },
});

function s03World() {
  const world = fakeContext("S03");
  const pages = withPages(world, {
    [OWNER]: { heard: "qa-c", marks: [{ name: "answered", at: Date.parse("2026-10-31T15:00:02.250Z") }] },
    "qa-c-owner": { heard: OWNER },
  });
  const rows = withRows(world, [
    row("QA-C", "DEV-W1", "qa-c-session", { direction: "outbound" }),
    row("QA-W", "DEV-C1", "qa-w-session", { direction: "inbound" }),
  ]);
  const meters = new Map([
    ["QA-C/qa-c-session", 20],
    ["QA-W/qa-w-session", 20],
  ]);
  const app: AppApi = world.app;
  app.meteredSeconds = async (args) => meters.get(`${args.tenant}/${args.callSessionId}`) ?? 0;
  world.app.legs.set("QA-W/qa-w-session", [{ member: OWNER, state: "answered", kind: "ring" }]);
  return { ...world, ...pages, rows, meters };
}

describe("S03, Loonext calls Loonext across workspaces", () => {
  it("passes when each page hears the other and each workspace keeps and bills its own row", async () => {
    const { ctx, browser, heard, did } = s03World();
    expect(await S03.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(browser.opened).toEqual([
      { member: OWNER, surface: OWNER, path: undefined },
      { member: "qa-c-owner", surface: "qa-c", path: "/calls" },
    ]);
    expect(did("qa-c-owner", "dial").map((entry) => entry.args)).toEqual([["DEV-W1"]]);
    expect(did(OWNER, "answer")).toHaveLength(1);
    // No robot: the caller's window counts from the callee's own answer mark.
    expect(heard.find((h) => h.member === "qa-c-owner")?.options).toEqual({ answeredAt: Date.parse("2026-10-31T15:00:02.250Z") });
    expect(ctx.evidence.rows).toMatchObject({ "QA-C": { call_session_id: "qa-c-session" }, "QA-W": { call_session_id: "qa-w-session" } });
    expect(ctx.evidence.legs).toEqual({ "QA-C": [], "QA-W": [{ member: OWNER, state: "answered", kind: "ring" }] });
    expect(ctx.evidence.billing).toEqual({ qa_c: 20, qa_w: 20, crossed: 0 });
  });

  it("calls a session key or a meter shared across the two workspaces critical", async () => {
    const shared = s03World();
    shared.rows[1]!.call_session_id = "qa-c-session";
    expect(await S03.run(shared.ctx)).toMatchObject({ failure_class: "shared_session_key", critical: true });

    const crossed = s03World();
    crossed.meters.set("QA-C/qa-w-session", 20);
    expect(await S03.run(crossed.ctx)).toMatchObject({ failure_class: "billed_to_other_workspace", critical: true });
  });

  it("names a missed ring, a deaf page, a missing row, an unmetered workspace and a text-back", async () => {
    const unrung = s03World();
    withPages(unrung, { [OWNER]: { rings: [undefined] } });
    expect(await S03.run(unrung.ctx)).toMatchObject({ failure_class: "no_ring" });
    expect(unrung.browser.actions).toContain("qa-c-owner hang up");

    const deafCaller = s03World();
    withPages(deafCaller, { [OWNER]: { heard: "qa-c" }, "qa-c-owner": { heard: null } });
    expect(await S03.run(deafCaller.ctx)).toMatchObject({ failure_class: "caller_did_not_hear_callee" });

    const deafCallee = s03World();
    withPages(deafCallee, { [OWNER]: { heard: "robot" }, "qa-c-owner": { heard: OWNER } });
    expect(await S03.run(deafCallee.ctx)).toMatchObject({ failure_class: "callee_did_not_hear_caller" });

    const noOutbound = s03World();
    noOutbound.rows[0]!.ended_at = null;
    expect(await S03.run(noOutbound.ctx)).toMatchObject({ failure_class: "no_outbound_row" });

    const noInbound = s03World();
    noInbound.rows.pop();
    expect(await S03.run(noInbound.ctx)).toMatchObject({ failure_class: "no_inbound_row" });

    const callerFree = s03World();
    callerFree.meters.delete("QA-C/qa-c-session");
    expect(await S03.run(callerFree.ctx)).toMatchObject({ failure_class: "caller_not_metered" });

    const calleeFree = s03World();
    calleeFree.meters.delete("QA-W/qa-w-session");
    expect(await S03.run(calleeFree.ctx)).toMatchObject({ failure_class: "callee_not_metered" });

    const texted = s03World();
    texted.app.thread("QA-W", "Sorry we missed you", "outbound", { withRole: "DEV-C1" });
    expect(await S03.run(texted.ctx)).toMatchObject({ failure_class: "text_back_after_answer" });
  });
});

function s05World(options: { textBack?: boolean; escalation?: boolean } = {}) {
  const world = fakeContext("S05");
  const seen = withLeaseAtChanges(world);
  const pages = withPages(world, {});
  const rows = withRows(world, [row("QA-W", "ROBOT-1", "s05-session", { outcome: "missed", forward_seconds: 0 })]);
  world.app.pushes.push({ tenant: "QA-W", purpose: "ring", platform: "web", response_class: "accepted", attempted_at: iso(world.time.now) });
  robotOutcome(world, (record) => ({ ...record, answered_at: undefined, judgement: undefined, recording_deleted: undefined }));
  const wait = world.robot.wait.bind(world.robot);
  // The caller hung up: the API texts back and opens the on-call escalation.
  world.robot.wait = async (planId: string) => {
    const record = await wait(planId);
    if (options.textBack !== false) world.robot.deliver({ from_role: "DEV-W1", to_role: "ROBOT-1", text: "Sorry we missed you" });
    if (options.escalation !== false) {
      world.app.escalationRows.push({
        tenant: "QA-W",
        created_at: iso(world.time.now),
        kind: "missed_call",
        on_call_user_id: "owner-user",
        escalate_at: iso(world.time.now + ESCALATE_AFTER_MINUTES * 60_000),
        escalated_at: null,
        acknowledged_at: null,
      });
    }
    return record;
  };
  const fire = world.app.fireCron.bind(world.app);
  const app: AppApi = world.app;
  // The escalation sweep, on the cron's scheduled time.
  app.fireCron = async (cron, at) => {
    await fire(cron, at);
    for (const escalation of world.app.escalationRows) {
      if (at !== undefined && Date.parse(escalation.escalate_at) <= at) escalation.escalated_at = iso(at);
    }
  };
  return { ...world, ...pages, seen, rows };
}

describe("S05, the caller hangs up while it rings", () => {
  it("passes with a missed row, a text-back, a ring push and an escalation the cron widens", async () => {
    const world = s05World();
    world.app.companies.set("QA-W", { on_call_escalate_after_minutes: 15, ring_seconds: 30 });
    expect(await S05.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans).toEqual([
      expect.objectContaining({ role: "ROBOT-1", to: "DEV-W1", hangup_before_answer_ms: 8_000, play: null, record: false, lease_id: "lease-test" }),
    ]);
    expect(world.did(OWNER, "answer")).toEqual([]);
    expect(world.app.companies.get("QA-W")).toMatchObject({
      on_call_escalate_after_minutes: 10,
      business_hours: {},
      after_hours_calls: "ring_everyone",
      timezone: "America/Toronto",
    });
    expect(world.app.shifts[0]).toMatchObject({ tenant: "QA-W", member: OWNER, role: "DEV-W1" });
    const [fired] = world.app.firedCrons;
    expect(fired?.cron).toBe("* * * * *");
    expect(fired!.at!).toBeGreaterThanOrEqual(Date.parse(world.app.escalationRows[0]!.escalate_at));
  });

  it("registers each undo before the change it reverses", async () => {
    const world = s05World();
    world.app.companies.set("QA-W", { on_call_escalate_after_minutes: 15, ring_seconds: 30 });
    await S05.run(world.ctx);
    const restore = world.undo[0]!;
    expect(restore).toMatchObject({ kind: "app.company-restore", params: { tenant: "QA-W" } });
    expect(restore.params.values).toMatchObject({ on_call_escalate_after_minutes: 15, ring_seconds: 30, business_hours: null });
    expect(world.seen.patches[0]).toEqual([restore]);
    const [shift] = world.seen.shifts;
    expect(shift!.undo.at(-1)).toEqual({ kind: "app.remove-on-call", params: { id: shift!.args.id } });
    expect(world.undo).toHaveLength(2);
  });

  it("names an answered call, a missing text-back, row, push or escalation, and an escalation left narrow", async () => {
    const answered = s05World();
    robotOutcome(answered, (record) => ({ ...record, answered_at: "2026-10-31T15:00:06.000Z" }));
    expect(await S05.run(answered.ctx)).toMatchObject({ failure_class: "answered_while_ringing" });

    const silent = s05World({ textBack: false });
    expect(await S05.run(silent.ctx)).toMatchObject({ failure_class: "no_text_back" });

    const rowless = s05World();
    rowless.rows.pop();
    expect(await S05.run(rowless.ctx)).toMatchObject({ failure_class: "no_call_row" });

    const answeredRow = s05World();
    answeredRow.rows[0]!.outcome = "voicemail";
    expect(await S05.run(answeredRow.ctx)).toMatchObject({ failure_class: "row_not_missed" });

    const unpushed = s05World();
    unpushed.app.pushes = [{ tenant: "QA-W", purpose: "alert", platform: "web", response_class: "accepted", attempted_at: iso(unpushed.time.now) }];
    expect(await S05.run(unpushed.ctx)).toMatchObject({ failure_class: "no_ring_push" });

    const unescalated = s05World({ escalation: false });
    expect(await S05.run(unescalated.ctx)).toMatchObject({ failure_class: "no_escalation" });

    const narrow = s05World();
    const app: AppApi = narrow.app;
    app.fireCron = async () => undefined;
    expect(await S05.run(narrow.ctx)).toMatchObject({ failure_class: "escalation_not_widened" });
  });

  it("blames the cron, not the product, when it cannot fire", async () => {
    const down = s05World();
    (down.app as AppApi).fireCron = async () => {
      throw new Error("app probe: firing * * * * * returned 404");
    };
    expect(await S05.run(down.ctx)).toMatchObject({ outcome: "infra", component: "cron" });
  });

  it("changes nothing and dials nothing when the probe cannot read the settings it would overwrite", async () => {
    const world = fakeContext("S05");
    (world.app as AppApi).companySettings = async () => {
      throw new Error("app probe: reading companies returned 503");
    };
    const result = await S05.run(world.ctx);
    expect(result).toMatchObject({ outcome: "infra", component: "app-probe" });
    expect((result as Extract<ScenarioResult, { outcome: "infra" }>).detail).toContain("returned 503");
    expect(world.undo).toEqual([]);
    expect(world.app.companies.size).toBe(0);
    expect(world.robot.plans).toEqual([]);
  });
});

function s06World(heard: Record<string, Surface[]> = { hold: [], after_hold: [OWNER], mute: [], after_mute: [OWNER] }) {
  const world = fakeContext("S06");
  const pages = withPages(world, {});
  robotOutcome(world, (record) => ({ ...withSegments(record, heard), gathered: { digits: "123", status: "valid" }, dtmf: "123#" }));
  return { ...world, ...pages };
}

describe("S06, hold, mute and keypad", () => {
  it("passes when the code drops out on hold and mute, comes back, and the digits arrive in order", async () => {
    const { ctx, robot, log } = s06World();
    expect(await S06.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(robot.plans[0]).toMatchObject({
      to: "DEV-W1",
      expect: OWNER,
      gather: { max_digits: 4, terminating_digit: "#" },
      segments: S06_SEGMENTS,
    });
    // Each control at its offset from Telnyx's answer, as the robot's windows count.
    const controls = log.filter((entry) => ["hold", "mute", "pressKeys"].includes(entry.action));
    expect(controls.map((entry) => [entry.action, entry.args, entry.at - ROBOT_ANSWERED])).toEqual([
      ["hold", [true], S06_STEPS.holdOn],
      ["hold", [false], S06_STEPS.holdOff],
      ["mute", [true], S06_STEPS.muteOn],
      ["mute", [false], S06_STEPS.muteOff],
      ["pressKeys", ["123#"], S06_STEPS.keys],
    ]);
  });

  it("keeps each window a margin inside its hold or mute, and judges the return from resume plus 2 s", () => {
    const [hold, afterHold, mute, afterMute] = S06_SEGMENTS;
    expect(hold!.start_ms).toBeGreaterThan(S06_STEPS.holdOn);
    expect(hold!.end_ms).toBeLessThan(S06_STEPS.holdOff);
    expect(afterHold!.start_ms).toBeGreaterThanOrEqual(S06_STEPS.holdOff + RETURN_MS);
    expect(mute!.start_ms).toBeGreaterThan(S06_STEPS.muteOn);
    expect(mute!.end_ms).toBeLessThan(S06_STEPS.muteOff);
    expect(afterMute!.start_ms).toBeGreaterThanOrEqual(S06_STEPS.muteOff + RETURN_MS);
    expect(afterMute!.end_ms).toBeLessThanOrEqual(S06_STEPS.keys);
  });

  it("names a code heard on hold or while muted, one that never came back, and wrong or missing digits", async () => {
    const cases: [Record<string, Surface[]>, string][] = [
      [{ hold: [OWNER], after_hold: [OWNER], mute: [], after_mute: [OWNER] }, "heard_during_hold"],
      [{ hold: [], after_hold: [], mute: [], after_mute: [OWNER] }, "not_back_after_hold"],
      [{ hold: [], after_hold: [OWNER], mute: [OWNER], after_mute: [OWNER] }, "heard_while_muted"],
      [{ hold: [], after_hold: [OWNER], mute: [], after_mute: [] }, "not_back_after_mute"],
    ];
    for (const [heard, failure] of cases) {
      expect(await S06.run(s06World(heard).ctx)).toMatchObject({ failure_class: failure });
    }
    // Hold music is not the member's code.
    expect((await S06.run(s06World({ hold: ["robot"], after_hold: [OWNER], mute: [], after_mute: [OWNER] }).ctx)).outcome).toBe("pass");

    const wrong = s06World();
    robotOutcome(wrong, (record) => ({ ...record, gathered: { digits: "132" } }));
    expect(await S06.run(wrong.ctx)).toMatchObject({ failure_class: "wrong_digits" });

    const none = s06World();
    robotOutcome(none, (record) => ({ ...record, gathered: undefined }));
    expect(await S06.run(none.ctx)).toMatchObject({ failure_class: "digits_not_gathered" });

    const deaf = s06World();
    robotOutcome(deaf, deafRobot);
    expect(await S06.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_member" });
  });

  it("blames the lane when a control is missing, and the robot when it judged no windows", async () => {
    const world = s06World();
    withPages(world, { [OWNER]: { broken: ["mute"] } });
    expect(await S06.run(world.ctx)).toMatchObject({ outcome: "infra", component: "browser-lane" });

    const unjudged = fakeContext("S06");
    withPages(unjudged, {});
    robotOutcome(unjudged, (record) => ({ ...record, judgement: { ...record.judgement!, segments: undefined } }));
    expect(await S06.run(unjudged.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
  });
});

function s07World(variant: TransferVariant) {
  const world = fakeContext("S07");
  world.ctx.slot = { index: 0, label: variant };
  const seen = withLeaseAtChanges(world);
  const pages = withPages(world, {
    [OWNER]: { rings: variant === "blind" ? [1_500] : [1_500, 2_000] },
    [TECH]: { rings: [2_000] },
  });
  if (variant !== "hop-cap") robotOutcome(world, (record) => withSegments(record, { after: variant === "blind" ? [TECH] : [OWNER] }));
  const rows = withRows(world, [row("QA-W", "ROBOT-1", "s07-session", { outcome: variant === "hop-cap" ? "voicemail" : "answered" })]);
  world.app.legs.set(
    "QA-W/s07-session",
    variant === "blind"
      ? [
          { member: OWNER, state: "answered", kind: "ring" },
          { member: TECH, state: "answered", kind: "transfer" },
        ]
      : [
          { member: OWNER, state: "answered", kind: "ring" },
          { member: TECH, state: "failed", kind: "transfer" },
          { member: OWNER, state: "answered", kind: "transfer" },
        ],
  );
  return { ...world, ...pages, seen, rows };
}

describe("S07, blind transfer and its variants", () => {
  it("passes a blind transfer: the robot hears the technician after it, and the leg is recorded", async () => {
    const world = s07World("blind");
    expect(await S07.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans).toEqual([expect.objectContaining({ role: "ROBOT-1", to: "DEV-W2", expect: OWNER, lease_id: "lease-test" })]);
    expect(world.did(OWNER, "transfer").map((entry) => entry.args)).toEqual([[{ to: TECHNICIAN_NAME, mode: "blind" }]]);
    expect(world.did(OWNER, "transfer")[0]!.at - ROBOT_ANSWERED).toBe(TRANSFER_AT_MS);
    expect(world.did(TECH, "answer")).toHaveLength(1);
    // Both pages are open before the robot dials.
    expect(world.browser.opened.map((page) => page.member)).toEqual([OWNER, TECH]);
  });

  it("rings the crew in turn under an undo registered first, so a snap-back stays inside three dials", async () => {
    const world = s07World("decline");
    world.app.companies.set("QA-W", { ring_strategy: "all" });
    await S07.run(world.ctx);
    expect(world.app.companies.get("QA-W")).toEqual({ ring_strategy: "in_turn" });
    expect(world.seen.patches[0]).toEqual([{ kind: "app.company-restore", params: { tenant: "QA-W", values: { ring_strategy: "all" } } }]);
    expect(world.did(OWNER, "waitForRing")[0]!.args).toEqual([OWNER_RING_MS]);
  });

  it("names a blind transfer the robot did not follow, one never recorded, and one that never rang", async () => {
    const stayed = s07World("blind");
    robotOutcome(stayed, (record) => withSegments(record, { after: [OWNER] }));
    expect(await S07.run(stayed.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_target" });

    const both = s07World("blind");
    robotOutcome(both, (record) => withSegments(record, { after: [TECH, OWNER] }));
    expect(await S07.run(both.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_target" });

    const unrecorded = s07World("blind");
    unrecorded.app.legs.set("QA-W/s07-session", [{ member: OWNER, state: "answered", kind: "ring" }]);
    expect(await S07.run(unrecorded.ctx)).toMatchObject({ failure_class: "transfer_not_recorded" });

    const unrung = s07World("blind");
    withPages(unrung, { [OWNER]: { rings: [1_500] }, [TECH]: { rings: [undefined] } });
    expect(await S07.run(unrung.ctx)).toMatchObject({ failure_class: "transfer_never_rang" });

    const ownerless = s07World("blind");
    withPages(ownerless, { [OWNER]: { rings: [undefined] } });
    expect(await S07.run(ownerless.ctx)).toMatchObject({ failure_class: "no_ring" });

    const deaf = s07World("blind");
    robotOutcome(deaf, deafRobot);
    expect(await S07.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_member" });

    const rowless = s07World("blind");
    rowless.rows.pop();
    expect(await S07.run(rowless.ctx)).toMatchObject({ failure_class: "no_call_row" });
  });

  it("passes a decline and a timeout that snap back to the owner, and fails one that stays with the technician", async () => {
    for (const variant of ["decline", "timeout"] as const) {
      const world = s07World(variant);
      expect(await S07.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
      expect(world.did(TECH, "decline")).toHaveLength(variant === "decline" ? 1 : 0);
      expect(world.did(TECH, "answer")).toEqual([]);
      expect(world.did(OWNER, "answer")).toHaveLength(2);

      const stuck = s07World(variant);
      robotOutcome(stuck, (record) => withSegments(record, { after: [TECH] }));
      expect(await S07.run(stuck.ctx)).toMatchObject({ failure_class: "did_not_snap_back" });

      const lost = s07World(variant);
      withPages(lost, { [OWNER]: { rings: [1_500, undefined] }, [TECH]: { rings: [2_000] } });
      expect(await S07.run(lost.ctx)).toMatchObject({ failure_class: "no_snap_back" });
    }
  });

  it("waits out the transfer's own ring before looking for a timeout's snap-back", async () => {
    const world = s07World("timeout");
    await S07.run(world.ctx);
    const [, snapBack] = world.did(OWNER, "waitForRing");
    expect(snapBack!.args[0]).toBeGreaterThan(TRANSFER_RING_SECS * 1_000);
  });

  it("passes the hop cap when a missed snap-back reaches voicemail, and fails one that does not", async () => {
    const world = s07World("hop-cap");
    expect(await S07.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.did(TECH, "decline")).toHaveLength(1);
    expect(world.did(OWNER, "decline")).toHaveLength(1);
    expect(world.robot.plans[0]!.segments).toBeUndefined();

    const answered = s07World("hop-cap");
    answered.rows[0]!.outcome = "answered";
    expect(await S07.run(answered.ctx)).toMatchObject({ failure_class: "hop_cap_not_voicemail" });
  });

  it("blames the lane when the transfer control fails, and refuses a variant it does not know", async () => {
    const world = s07World("blind");
    withPages(world, { [OWNER]: { broken: ["transfer"] } });
    expect(await S07.run(world.ctx)).toMatchObject({ outcome: "infra", component: "browser-lane" });

    const unknown = s07World("blind");
    unknown.ctx.slot = { index: 0, label: "consult" };
    expect(await S07.run(unknown.ctx)).toMatchObject({ outcome: "infra", component: "runner" });
    expect(unknown.robot.plans).toEqual([]);
  });

  it("opens every after-transfer window only after the latest answer it can follow, and hangs up after it", () => {
    for (const variant of S07_VARIANTS) {
      const { targetBy, snapBackBy, after, hangup } = transferTimeline(variant);
      const settled = snapBackBy ?? targetBy;
      expect(targetBy).toBeGreaterThan(TRANSFER_AT_MS);
      if (after) {
        expect(after.start_ms).toBeGreaterThanOrEqual(settled + RETURN_MS);
        expect(hangup).toBeGreaterThan(after.end_ms);
      } else {
        expect(hangup).toBeGreaterThan(settled);
      }
    }
    expect(transferTimeline("timeout").snapBackBy! - transferTimeline("decline").snapBackBy!).toBe(TRANSFER_RING_SECS * 1_000);
  });
});

function s08World(direction: "inbound" | "outbound") {
  const world = fakeContext("S08");
  world.ctx.slot = { index: 0, label: direction };
  const seen = withLeaseAtChanges(world);
  const pages = withPages(world, { [OWNER]: { heard: TECH }, [TECH]: { heard: OWNER } });
  robotOutcome(world, (record) => withSegments(record, { consult: [], after: [TECH] }));
  const rows = withRows(world, [row("QA-W", "ROBOT-1", "s08-session")]);
  world.app.legs.set("QA-W/s08-session", [{ member: OWNER, state: "answered", kind: "ring" }]);
  return { ...world, ...pages, seen, rows };
}

describe("S08, consult transfer", () => {
  it("passes inbound: the robot hears nobody while the pages talk, then the technician, and the owner's leg is gone", async () => {
    const world = s08World("inbound");
    expect(await S08.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans[0]).toMatchObject({ direction: "outbound", to: "DEV-W2", segments: [CONSULT_SEGMENT, AFTER_COMPLETE_SEGMENT] });
    expect(world.app.companies.get("QA-W")).toEqual({ ring_strategy: "in_turn" });
    expect(world.did(OWNER, "transfer").map((entry) => [entry.args, entry.at - ROBOT_ANSWERED])).toEqual([
      [[{ to: TECHNICIAN_NAME, mode: "consult" }], CONSULT_AT_MS],
    ]);
    expect(world.did(OWNER, "completeTransfer")[0]!.at - ROBOT_ANSWERED).toBe(COMPLETE_AT_MS);
    expect(world.did(OWNER, "mark").map((entry) => entry.args)).toEqual([["consult_answered"]]);
    const sender = world.heard.find((h) => h.member === OWNER)!.options!;
    const target = world.heard.find((h) => h.member === TECH)!.options!;
    expect(sender).toMatchObject({ answerMark: "consult_answered", windowStartMs: 2_000 });
    expect(target.windowEndMs).toBe(sender.windowEndMs);
  });

  it("passes outbound, where the owner calls ROBOT-1 and nothing about the crew ring changes", async () => {
    const world = s08World("outbound");
    expect(await S08.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans[0]).toMatchObject({ direction: "inbound", role: "ROBOT-1", answer_after_ms: 3_000 });
    expect(world.did(OWNER, "dial").map((entry) => entry.args)).toEqual([["ROBOT-1"]]);
    expect(world.undo).toEqual([]);
  });

  it("alternates direction week by week unless the slot names one", () => {
    const now = Date.UTC(2026, 9, 31, 15);
    const at = (ms: number, label?: string) => consultDirection({ now: () => ms, slot: { index: 0, label } });
    expect(at(now)).not.toBe(at(now + 7 * 86_400_000));
    expect(at(now)).toBe(at(now + 14 * 86_400_000));
    expect(at(now, "outbound")).toBe("outbound");
    expect(at(now + 7 * 86_400_000, "inbound")).toBe("inbound");
  });

  it("reports a call bar with no consult control as the lane's fault, never the product's", async () => {
    const world = s08World("inbound");
    withPages(world, { [OWNER]: { noConsult: true }, [TECH]: { rings: [undefined] } });
    const result = await S08.run(world.ctx);
    expect(result).toMatchObject({ outcome: "infra", component: "browser-lane" });
    expect((result as Extract<ScenarioResult, { outcome: "infra" }>).detail).toContain("offered no consult transfer");

    const incomplete = s08World("outbound");
    withPages(incomplete, { [OWNER]: { heard: TECH, broken: ["completeTransfer"] }, [TECH]: { heard: OWNER } });
    expect(await S08.run(incomplete.ctx)).toMatchObject({ outcome: "infra", component: "browser-lane" });
  });

  it("names a consult the robot overheard, pages that did not hear each other, a robot that never reached the target and a sender leg left up", async () => {
    const overheard = s08World("inbound");
    robotOutcome(overheard, (record) => withSegments(record, { consult: [OWNER], after: [TECH] }));
    expect(await S08.run(overheard.ctx)).toMatchObject({ failure_class: "robot_heard_consult" });

    const deafSender = s08World("inbound");
    withPages(deafSender, { [OWNER]: { heard: "robot" }, [TECH]: { heard: OWNER } });
    expect(await S08.run(deafSender.ctx)).toMatchObject({ failure_class: "sender_did_not_hear_target" });

    const deafTarget = s08World("inbound");
    withPages(deafTarget, { [OWNER]: { heard: TECH }, [TECH]: { heard: null } });
    expect(await S08.run(deafTarget.ctx)).toMatchObject({ failure_class: "target_did_not_hear_sender" });

    const notTarget = s08World("outbound");
    robotOutcome(notTarget, (record) => withSegments(record, { consult: [], after: [OWNER] }));
    expect(await S08.run(notTarget.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_target" });

    const lingering = s08World("inbound");
    lingering.app.legs.set("QA-W/s08-session", [{ member: OWNER, state: "answered", kind: "consult" }]);
    expect(await S08.run(lingering.ctx)).toMatchObject({ failure_class: "sender_leg_not_ended" });

    const unrung = s08World("inbound");
    withPages(unrung, { [OWNER]: { heard: TECH }, [TECH]: { rings: [undefined] } });
    expect(await S08.run(unrung.ctx)).toMatchObject({ failure_class: "consult_never_rang" });

    const unanswered = s08World("outbound");
    robotOutcome(unanswered, (record) => ({ ...record, answered_at: undefined }));
    expect(await S08.run(unanswered.ctx)).toMatchObject({ failure_class: "not_answered" });
  });
});

function s09World(options: { dialsThrough?: boolean } = {}) {
  const world = fakeContext("S09");
  world.guard.log = { "rig-api POST /v2/calls 200": 1, "robot POST /v2/calls 200": 2 };
  const pages = withPages(world, {
    [OWNER]: {
      onDial: (role) => {
        const key = "rig-api POST /v2/calls 200";
        if (role === "ROBOT-2" && options.dialsThrough) world.guard.log[key] = (world.guard.log[key] ?? 0) + 1;
      },
    },
  });
  robotOutcome(world, (record, plan) =>
    plan.role === "ROBOT-2" ? { ...record, dialed_at: "2026-10-31T15:00:10.000Z", answered_at: "2026-10-31T15:00:13.500Z" } : record,
  );
  const rows = withRows(world, [
    row("QA-W", "ROBOT-2", "busy-session", { outcome: "voicemail", forward_seconds: 0 }),
    row("QA-W", "DEV-W1", "self-outbound", { outcome: "answered", direction: "outbound" }),
    row("QA-W", "DEV-W1", "self-inbound", { outcome: "voicemail", direction: "inbound" }),
  ]);
  return { ...world, ...pages, rows };
}

const refusedDial = (error: string) => async (plan: CallPlan): Promise<CallRecord> => ({
  plan_id: "plan-1",
  plan,
  state: "failed",
  ids: {},
  events: [],
  dtmf: "",
  errors: [error],
});

describe("S09, busy line, second caller and self-dial", () => {
  it("passes when the busy line sends ROBOT-2 to voicemail, refuses the owner's dial and voicemails a self-dial", async () => {
    const world = s09World();
    expect(await S09.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans.map((plan) => [plan.role, plan.to])).toEqual([
      ["ROBOT-1", "DEV-W1"],
      ["ROBOT-2", "DEV-W1"],
    ]);
    expect(world.did(OWNER, "dial").map((entry) => entry.args)).toEqual([["ROBOT-2"], ["DEV-W1"]]);
    expect(world.did(OWNER, "waitForText").map((entry) => entry.args[0])).toEqual([NUMBER_BUSY_TEXT]);
    expect(world.ctx.evidence).toMatchObject({ busy_voicemail_ms: 3_500, dials_while_busy: 0 });
  });

  it("reports the robot when the second robot call is refused by the guard or by Telnyx", async () => {
    const guarded = s09World();
    const dial = guarded.robot.dial.bind(guarded.robot);
    guarded.robot.dial = async (plan) => (plan.role === "ROBOT-2" ? refusedDial("guard_refused:dial.concurrency")(plan) : dial(plan));
    expect(await S09.run(guarded.ctx)).toMatchObject({ outcome: "infra", component: "robot" });

    const telnyx = s09World();
    robotOutcome(telnyx, (record, plan) => (plan.role === "ROBOT-2" ? { ...record, state: "failed", answered_at: undefined, errors: ["dial: Telnyx 403 on /v2/calls (D60)"] } : record));
    expect(await S09.run(telnyx.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
  });

  it("names a slow or missing voicemail, no busy notice, a dial from the busy line and a self-dial that rang", async () => {
    const late = s09World();
    robotOutcome(late, (record, plan) =>
      plan.role === "ROBOT-2" ? { ...record, dialed_at: "2026-10-31T15:00:10.000Z", answered_at: "2026-10-31T15:00:18.500Z" } : record,
    );
    expect(await S09.run(late.ctx)).toMatchObject({ failure_class: "busy_voicemail_late" });

    const unanswered = s09World();
    robotOutcome(unanswered, (record, plan) => (plan.role === "ROBOT-2" ? { ...record, answered_at: undefined } : record));
    expect(await S09.run(unanswered.ctx)).toMatchObject({ failure_class: "busy_caller_not_answered" });

    const busyRow = s09World();
    busyRow.rows[0]!.outcome = "missed";
    expect(await S09.run(busyRow.ctx)).toMatchObject({ failure_class: "busy_row_not_voicemail" });

    const quiet = s09World();
    withPages(quiet, { [OWNER]: { showsText: false } });
    expect(await S09.run(quiet.ctx)).toMatchObject({ failure_class: "no_busy_notice" });

    const through = s09World({ dialsThrough: true });
    expect(await S09.run(through.ctx)).toMatchObject({ failure_class: "dialed_while_busy" });

    const rang = s09World();
    rang.rows[2]!.outcome = "answered";
    expect(await S09.run(rang.ctx)).toMatchObject({ failure_class: "self_dial_not_voicemail" });

    const firstLost = s09World();
    robotOutcome(firstLost, (record, plan) => (plan.role === "ROBOT-1" ? { ...record, answered_at: undefined } : { ...record, dialed_at: "2026-10-31T15:00:10.000Z", answered_at: "2026-10-31T15:00:13.500Z" }));
    expect(await S09.run(firstLost.ctx)).toMatchObject({ failure_class: "not_answered" });
  });
});

function s10World() {
  const world = fakeContext("S10");
  const pages = withPages(world, {
    [OWNER]: { heard: TECH },
    [TECH]: { heard: OWNER, marks: [{ name: "answered", at: Date.parse("2026-10-31T15:00:01.700Z") }] },
  });
  const rows = withRows(world, [
    row("QA-W", "DEV-W1", "w2-inbound", { direction: "inbound" }),
    row("QA-W", "DEV-W2", "w1-outbound", { direction: "outbound" }),
  ]);
  return { ...world, ...pages, rows };
}

describe("S10, DEV-W1 calls DEV-W2 in one workspace", () => {
  it("passes when the crew rings, the owner sees call waiting, and the two pages hear each other", async () => {
    const world = s10World();
    expect(await S10.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(world.robot.plans).toEqual([]);
    expect(world.did(OWNER, "dial").map((entry) => entry.args)).toEqual([["DEV-W2"]]);
    expect(world.did(OWNER, "waitForText").map((entry) => entry.args[0])).toEqual([CALL_WAITING_TEXT]);
    expect(world.did(TECH, "answer")).toHaveLength(1);
    expect(world.heard.find((h) => h.member === OWNER)?.options).toEqual({ answeredAt: Date.parse("2026-10-31T15:00:01.700Z") });
    expect(world.ctx.evidence.rows).toMatchObject({ inbound: { call_session_id: "w2-inbound" }, outbound: { call_session_id: "w1-outbound" } });
  });

  it("names a crew or owner that never rang, no call waiting, deaf pages and a missing or unanswered row", async () => {
    const crewless = s10World();
    withPages(crewless, { [TECH]: { rings: [undefined] } });
    expect(await S10.run(crewless.ctx)).toMatchObject({ failure_class: "crew_not_rung" });

    const ownerless = s10World();
    withPages(ownerless, { [OWNER]: { heard: TECH, rings: [undefined] }, [TECH]: { heard: OWNER } });
    expect(await S10.run(ownerless.ctx)).toMatchObject({ failure_class: "owner_not_rung" });

    const unwaiting = s10World();
    withPages(unwaiting, { [OWNER]: { heard: TECH, showsText: false }, [TECH]: { heard: OWNER } });
    expect(await S10.run(unwaiting.ctx)).toMatchObject({ failure_class: "no_call_waiting" });

    const deafCaller = s10World();
    withPages(deafCaller, { [OWNER]: { heard: null }, [TECH]: { heard: OWNER } });
    expect(await S10.run(deafCaller.ctx)).toMatchObject({ failure_class: "caller_did_not_hear_crew" });

    const deafCrew = s10World();
    withPages(deafCrew, { [OWNER]: { heard: TECH }, [TECH]: { heard: "robot" } });
    expect(await S10.run(deafCrew.ctx)).toMatchObject({ failure_class: "crew_did_not_hear_caller" });

    const rowless = s10World();
    rowless.rows[0]!.direction = "outbound";
    expect(await S10.run(rowless.ctx)).toMatchObject({ failure_class: "no_call_row" });

    const missed = s10World();
    missed.rows[0]!.outcome = "missed";
    expect(await S10.run(missed.ctx)).toMatchObject({ failure_class: "row_not_answered" });
  });
});

function s11World(ringLengthMs = S11_RING_SECONDS * 1_000 + 900) {
  const world = fakeContext("S11");
  const seen = withLeaseAtChanges(world);
  const pages = withPages(world, { [OWNER]: { ringsAfterMs: undefined }, [TECH]: { ringsAfterMs: 1_800 } });
  const dialedAt = Date.parse("2026-10-31T15:00:00.500Z");
  robotOutcome(world, (record) => ({ ...record, dialed_at: iso(dialedAt), answered_at: iso(dialedAt + ringLengthMs) }));
  return { ...world, ...pages, seen };
}

describe("S11, after hours, on call, in turn and ring length", () => {
  it("passes when only the on-call page rings and voicemail answers at the ring length", async () => {
    const world = s11World();
    expect(await S11.run(world.ctx)).toEqual({ outcome: "pass", detail: undefined });
    const values = world.app.companies.get("QA-W")!;
    expect(values).toMatchObject({ after_hours_calls: "on_call_only", ring_strategy: "in_turn", ring_seconds: 20, timezone: "America/Toronto", business_hours_exceptions: [] });
    expect(values.business_hours).toEqual(hoursClosedAt(Date.UTC(2026, 9, 31, 15)));
    expect(world.app.shifts[0]).toMatchObject({ tenant: "QA-W", member: TECH, role: "DEV-W2" });
    expect(world.app.shifts[0]!.startsAt).toBeLessThan(world.time.now);
    expect(world.robot.plans[0]).toMatchObject({ to: "DEV-W2", play: null, record: false });
    expect(world.did(OWNER, "waitForRing")[0]!.args).toEqual([15_000]);
    expect(world.ctx.evidence.ring_length_ms).toBe(20_900);
  });

  it("registers the restore and the shift's removal before either change", async () => {
    const world = s11World();
    await S11.run(world.ctx);
    expect(world.seen.patches[0]!.map((u) => u.kind)).toEqual(["app.company-restore"]);
    expect(world.seen.shifts[0]!.undo.map((u) => u.kind)).toEqual(["app.company-restore", "app.remove-on-call"]);
    expect(world.undo).toHaveLength(2);
  });

  it("names an on-call page that never rang, an owner who rang, no voicemail, and a ring of the wrong length", async () => {
    const unrung = s11World();
    withPages(unrung, { [OWNER]: { ringsAfterMs: undefined }, [TECH]: { ringsAfterMs: undefined } });
    expect(await S11.run(unrung.ctx)).toMatchObject({ failure_class: "on_call_not_rung" });

    const loud = s11World();
    withPages(loud, { [OWNER]: { ringsAfterMs: 2_000 }, [TECH]: { ringsAfterMs: 1_800 } });
    expect(await S11.run(loud.ctx)).toMatchObject({ failure_class: "off_call_rang" });

    const unanswered = s11World();
    robotOutcome(unanswered, (record) => ({ ...record, answered_at: undefined }));
    expect(await S11.run(unanswered.ctx)).toMatchObject({ failure_class: "voicemail_not_answered" });

    expect(await S11.run(s11World(S11_RING_SECONDS * 1_000 + 2_500).ctx)).toMatchObject({ failure_class: "ring_length" });
    expect(await S11.run(s11World(S11_RING_SECONDS * 1_000 - 2_500).ctx)).toMatchObject({ failure_class: "ring_length" });
    expect((await S11.run(s11World(S11_RING_SECONDS * 1_000 - 1_900).ctx)).outcome).toBe("pass");
  });

  it("seeds today's hours away from now on the destination clock, whatever the hour or the season", () => {
    const local = (at: number) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      return { day: part("weekday").toLowerCase(), minutes: Number(part("hour")) * 60 + Number(part("minute")) };
    };
    const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    const instants = [
      Date.UTC(2026, 9, 31, 7),
      Date.UTC(2026, 9, 31, 15),
      Date.UTC(2026, 10, 1, 3, 55),
      Date.UTC(2026, 11, 3, 4, 59),
      Date.UTC(2026, 6, 2, 3, 30),
      Date.UTC(2026, 6, 2, 4, 30),
    ];
    for (const at of instants) {
      const hours = hoursClosedAt(at);
      const { day, minutes } = local(at);
      expect(Object.keys(hours)).toEqual([day]);
      const { open, close } = hours[day]!;
      expect(open).toMatch(/^\d{2}:\d{2}$/);
      expect(toMinutes(open)).toBeLessThan(toMinutes(close));
      expect(minutes >= toMinutes(open) && minutes < toMinutes(close)).toBe(false);
    }
  });
});

const SCENARIOS = JSON.parse(readFileSync(new URL("../../../scenarios.json", import.meta.url), "utf8")) as {
  scenarios: { id: string; dials: number; far_end_legs: number }[];
};

describe("the phone-digits check on evidence", () => {
  const evidence = (value: string) => JSON.stringify({ on_call_shift: value, note: "x" });

  it("passes a UUID whose digits run ten or more in a row", () => {
    expect(holdsPhoneNumber(evidence("82f6ab5b-8e0f-4f61-861c-bd1627082885"))).toBe(false);
    expect(holdsPhoneNumber(evidence("82f6ab5b-8e0f-4f61-861c-162708288512"))).toBe(false);
    expect(holdsPhoneNumber(evidence("16270828-8512-4f61-861c-bd1627082885"))).toBe(false);
  });

  it("still fails a number written as E.164, bare digits or with separators", () => {
    for (const number of ["+14165550123", "4165550123", "tel:14165550123", "+1 416 555 0123", "(416) 555-0123", "416.555.0123"]) {
      expect(holdsPhoneNumber(evidence(number)), number).toBe(true);
    }
  });

  it("fails a number that follows letters or a JSON escape", () => {
    for (const text of ["x\n4165550123", "x\t4165550123", "id4165550123", "+14165550123x", "call4165550123"]) {
      expect(holdsPhoneNumber(evidence(text)), text).toBe(true);
    }
  });
});

describe("the budget in tools/rig/scenarios.json", () => {
  const runs: [string, ScenarioRunner, () => World][] = [
    ["S03", S03, s03World],
    ["S05", S05, s05World],
    ["S06", S06, s06World],
    ...S07_VARIANTS.map((variant): [string, ScenarioRunner, () => World] => ["S07", S07, () => s07World(variant)]),
    ["S08", S08, () => s08World("inbound")],
    ["S08", S08, () => s08World("outbound")],
    ["S09", S09, s09World],
    ["S10", S10, s10World],
    ["S11", S11, s11World],
  ];

  it("dials no more robot legs than each row's far_end_legs, and keeps numbers out of the evidence", async () => {
    for (const [id, runner, make] of runs) {
      const world = make();
      expect((await runner.run(world.ctx)).outcome, `${id} ${world.ctx.slot.label ?? ""}`).toBe("pass");
      const row = SCENARIOS.scenarios.find((s) => s.id === id)!;
      expect(world.robot.plans.length, id).toBeLessThanOrEqual(row.far_end_legs);
      expect(holdsPhoneNumber(JSON.stringify(world.ctx.evidence)), id).toBe(false);
    }
  });
});

describe("what the runners take from the rest of the repository", () => {
  const source = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), "utf8");

  it("names the technician as the seed does, and rings the numbers the seed's audiences ring", () => {
    const qaW = TENANTS.find((tenant) => tenant.key === "qa-w")!;
    expect(qaW.members.find((member) => member.key === "technician")?.displayName).toBe(TECHNICIAN_NAME);
    expect(qaW.numbers.map((number) => [number.role, number.rings])).toEqual([
      ["DEV-W1", ["owner"]],
      ["DEV-W2", ["owner", "technician"]],
    ]);
  });

  it("sets after-hours values packages/shared accepts", () => {
    const identity = source("packages/shared/src/number-identity.ts");
    expect(identity).toMatch(/AFTER_HOURS_CALLS: readonly AfterHoursCalls\[\] = \[[^\]]*"on_call_only"/);
    expect(identity).toMatch(/AFTER_HOURS_CALLS: readonly AfterHoursCalls\[\] = \[[^\]]*"ring_everyone"/);
    expect(identity).toMatch(/RING_STRATEGIES: readonly RingStrategy\[\] = \[[^\]]*"in_turn"/);
    const bound = (name: string) => Number(new RegExp(`${name} = (\\d+);`).exec(identity)![1]);
    expect(S11_RING_SECONDS).toBeGreaterThanOrEqual(bound("RING_SECONDS_MIN"));
    expect(S11_RING_SECONDS).toBeLessThanOrEqual(bound("RING_SECONDS_MAX"));
    // The owner answers before the next phone would join an in-turn ring.
    expect(OWNER_RING_MS).toBeLessThan(bound("RING_STEP_SECS") * 1_000);
  });

  it("times the transfer variants on the API's own transfer ring and hop cap", () => {
    const liveCall = source("apps/api/src/messaging/live-call.ts");
    expect(Number(/TRANSFER_TIMEOUT_SECS = (\d+);/.exec(liveCall)![1])).toBe(TRANSFER_RING_SECS);
    expect(liveCall).toMatch(/const MAX_TRANSFER_HOPS = 1;/);
  });

  it("waits for the words the app shows", () => {
    expect(source("apps/api/src/routes/calls.ts")).toContain(`"${NUMBER_BUSY_TEXT} right now."`);
    expect(source("apps/web/src/i18n/sections/shell.ts")).toContain(`incomingCallFrom: "${CALL_WAITING_TEXT}",`);
  });
});
