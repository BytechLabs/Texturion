/**
 * #315 gate lint, in the ImeContractLintTest idiom: a rank is not a permission
 * model, and a new route must not be ABLE to ship on one.
 *
 * `requireRole("admin")` and `requireRole("owner")` are converted — every one
 * of them now names the axis it means (`team.manage`, `numbers.manage`,
 * `settings.manage`, `history.read`, `contacts.bulk`, `workspace.own`). This
 * fails the build if one comes back, because the presets that close the
 * bookkeeper and read-only gaps are not on the owner ⊃ admin ⊃ member line,
 * and a rank gate refuses them wholesale rather than asking the right question.
 *
 * `requireRole("member")` is deliberately still allowed. Those 91 routes mean
 * "any active member", and they split two ways — some read, some send as the
 * business. They get converted by hand, route by route, when the read-only
 * observer lands; converting them mechanically would be a guess about which
 * half each one is, and guessing wrong either locks a crew out of their inbox
 * or lets an observer text a customer.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES, capabilitiesOf } from "@loonext/shared";

const ROUTES_DIR = join(import.meta.dirname, "..", "routes");

function routeSources(): { name: string; src: string }[] {
  // Recursive. It was a flat read, which scanned the top level only — and
  // `routes/core/` already exists beside it with eighteen files. Nothing there
  // gates today, so this was latent rather than broken, but the lint's reach
  // was pinned to a directory layout rather than to the route set: one
  // "group the privileged routes into routes/admin/" refactor would have moved
  // them out of view while every assertion here stayed green.
  return readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({
      name,
      src: readFileSync(join(ROUTES_DIR, name), "utf8"),
    }));
}

/**
 * Mutating routes deliberately gated on a capability the read-only preset
 * holds, each because the thing being changed is the CALLER'S OWN.
 *
 * This list is the point of the check below it. A member managing their own
 * notification preferences, their own push subscriptions, their own read
 * markers, their own saved views, their own departure, or claiming an ownership
 * handover they were personally named for, is not a privilege escalation — and
 * a rule that failed all of them would be the firehose #320 warns about, muted
 * within a week.
 *
 * Every entry is `METHOD /path`. Adding one is the moment somebody has to say
 * out loud why a write is safe for an observer.
 */
const SELF_SCOPED_WRITES = new Set([
  // Your own notification settings and delivery targets.
  "PUT /notification-prefs",
  "POST /push-subscriptions",
  "DELETE /push-subscriptions/:id",
  // Your own read markers. Marking what YOU have seen changes nothing anybody
  // else can observe.
  "POST /notifications/mark-all-read",
  "POST /notifications/:id/read",
  "POST /notifications/mark-read",
  // #332: the named backup claiming, accepting or cancelling a handover. The
  // whole point is that it is available to somebody who is not yet an owner.
  "POST /company/ownership/claim",
  "POST /company/ownership/accept",
  "POST /company/ownership/cancel",
  // #280: a saved view is a stored query over conversations you can already
  // read, owned by the member who saved it.
  "POST /saved-views",
  "PATCH /saved-views/:id",
  "DELETE /saved-views/:id",
  "POST /saved-views/reorder",
  "PUT /saved-views/default",
  // #406: leaving is always yours to do.
  "DELETE /members/me",
  // #286: "I have been through the joining orientation" is a statement about
  // yourself and nothing else. The route takes no body at all — the user id
  // comes from the verified session — so there is nobody it could be said on
  // behalf of, and it pairs with a read every role already holds.
  "POST /me/oriented",
]);

/**
 * #519 — mutating routes with NO capability gate at all, each because asking
 * for one would be asking the wrong question.
 *
 * Everything below this line is what the checks above could not see. They only
 * ever inspected routes that HAVE a `requireCapability`, so a write with none
 * was not a finding — it was invisible. That is the widest possible version of
 * "the guard asserts something is MENTIONED rather than that it WORKS": a route
 * that never mentions a capability was never asked about.
 *
 * Three kinds live here and no fourth:
 *
 *   PUBLIC — no session at all. A capability is a question about a member, and
 *   there is no member.
 *
 *   PRE-COMPANY — authenticated, but no company context exists yet, so no
 *   capability could be evaluated against one.
 *
 *   YOUR OWN — the row being changed is keyed to the caller. Gating these on
 *   anything would lock somebody out of their own account, which is the
 *   firehose failure #320 warns about.
 *
 * Adding an entry is the moment somebody says out loud why a write needs no
 * permission. If it does not fit one of the three, it needs a gate.
 */
const UNGATED_WRITES: Record<string, string> = {
  // PUBLIC — unauthenticated marketing surfaces.
  "POST /contact": "public — the marketing contact form, no session",
  "POST /marketing/comparison": "public — the comparison tool, no session",
  "POST /marketing/unsubscribe":
    "public — an unsubscribe must work from an email link, where the reader " +
    "is by definition not signed in",

  // PRE-COMPANY — authenticated, but no company to evaluate against.
  "POST /companies":
    "creates the workspace; there is no company context to hold a capability " +
    "until this returns",
  "POST /invites/accept":
    "the caller is not a member yet — that is what accepting does. The invite " +
    "token is the authorisation",

  // YOUR OWN — keyed to the caller, verified rather than assumed.
  "DELETE /account": "your own account",
  "PATCH /me": "your own profile",
  "POST /me/email/retry":
    "#386: your own bounced address. Company-exempt on purpose — an address " +
    "belongs to a person, not a workspace",
  "POST /device-push-tokens": "registers the caller's own device",
  "DELETE /device-push-tokens": "removes the caller's own device",
  "POST /mfa/recovery-codes": "your own second factor",
  "POST /mfa/recover": "your own second factor, when it is the way back in",
  "POST /sessions/revoke": "your own sessions",
  "POST /on-call/alerts/:id/acknowledge":
    "#244: acknowledging the page YOU were sent — the RPC is scoped to " +
    "`p_user_id: c.get(\"userId\")`, so one member cannot silence another's",
};

describe("route gates ask for a capability, not a rank", () => {
  it("finds the route sources (the lint itself still works)", () => {
    const sources = routeSources();
    expect(sources.length).toBeGreaterThan(20);
    // And they really are the gated ones.
    expect(sources.some((s) => s.src.includes("requireCapability("))).toBe(true);
  });

  it("no route gates on requireRole('admin')", () => {
    for (const { name, src } of routeSources()) {
      expect(
        src.includes('requireRole("admin")'),
        `${name} gates on the rank 'admin'. Use requireCapability with the ` +
          `axis it means — billing.manage, settings.manage, team.manage, ` +
          `numbers.manage, history.read or contacts.bulk (#315).`,
      ).toBe(false);
    }
  });

  it("no route gates on requireRole('owner')", () => {
    for (const { name, src } of routeSources()) {
      expect(
        src.includes('requireRole("owner")'),
        `${name} gates on the rank 'owner'. Use ` +
          `requireCapability("workspace.own") — the irreversible actions ` +
          `(overage cap, US enablement, number release, ownership transfer, ` +
          `closing the workspace) are one axis, not a rung (#315).`,
      ).toBe(false);
    }
  });

  it("every capability a route asks for is a real one", () => {
    // A typo'd capability would silently refuse EVERYONE, which reads as a
    // broken feature rather than as a permission bug.
    // DERIVED from the capability table, not listed here. The first version of
    // this test hand-listed them and went stale the moment an axis was added —
    // which is the failure mode this whole file exists to prevent.
    const known = new Set<string>(CAPABILITIES);
    let seen = 0;
    for (const { name, src } of routeSources()) {
      for (const match of src.matchAll(/requireCapability\("([^"]+)"\)/g)) {
        seen += 1;
        expect(known.has(match[1]), `${name} asks for "${match[1]}"`).toBe(true);
      }
    }
    // Guard the guard: a regex that stopped matching would pass vacuously.
    expect(seen).toBeGreaterThan(30);
  });

  it("no route that CHANGES something is gated on a read-only capability", () => {
    // What the assertion above cannot see. It checks that a capability is
    // SPELLED correctly, which `requireCapability(capability: Capability)`
    // already makes a compile error — so it can only catch a typo, and never
    // the regression that matters: a gate swapped for a different, weaker,
    // perfectly real capability.
    //
    // Concretely, changing compose.ts's `POST /conversations` from
    // `conversations.send` to `conversations.read` compiles, keeps the
    // spelling check green, and lets a read-only observer text a customer as
    // the business — the exact failure this file's header names. No route test
    // catches it either: they stub `role: "member"`, which holds both axes.
    //
    // So this asks the question the model actually cares about. `read_only`
    // is the least-privileged role that can see anything, and its capabilities
    // are DERIVED here rather than listed, so widening that preset re-checks
    // every route for free.
    const readOnly = new Set<string>(capabilitiesOf("read_only"));
    const offenders: string[] = [];
    let mutating = 0;
    for (const { name, src } of routeSources()) {
      for (const match of src.matchAll(
        /\.(post|patch|put|delete)\(\s*"([^"]+)"\s*,\s*requireCapability\("([^"]+)"\)/g,
      )) {
        mutating += 1;
        const [, method, path, capability] = match;
        if (!readOnly.has(capability)) continue;
        const route = `${method.toUpperCase()} ${path}`;
        if (SELF_SCOPED_WRITES.has(route)) continue;
        offenders.push(`${name}: ${route} -> ${capability}`);
      }
    }
    expect(
      offenders,
      "These change state but only demand a capability the read-only observer " +
        "already has. Either the gate is wrong, or the write is self-scoped " +
        "and belongs in SELF_SCOPED_WRITES with a reason:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
    // Guard the guard: this regex is stricter than the one above, so a change
    // in how routes are declared could silently empty it.
    expect(mutating).toBeGreaterThan(50);
  });

  it("the self-scoped list has no entries that stopped existing", () => {
    // An allow-list that outlives its routes is how a future write inherits an
    // exemption nobody granted it: delete `POST /saved-views`, add a different
    // `POST /saved-views` that shares crew-wide state, and it is pre-approved.
    const declared = new Set<string>();
    for (const { src } of routeSources()) {
      for (const match of src.matchAll(
        /\.(post|patch|put|delete)\(\s*"([^"]+)"/g,
      )) {
        declared.add(`${match[1].toUpperCase()} ${match[2]}`);
      }
    }
    const stale = [...SELF_SCOPED_WRITES].filter((r) => !declared.has(r));
    expect(
      stale,
      `SELF_SCOPED_WRITES names routes that no longer exist: ${stale.join(", ")}`,
    ).toEqual([]);
  });
  it("every write is gated, or says why it needs no gate (#519)", () => {
    // THE ONE THE OTHERS COULD NOT ASK. Every check above starts from a
    // `requireCapability` and reasons about it; a route with none was not
    // examined, it was absent. So a new `POST /invoices/:id/void` shipping
    // with no gate at all passed this entire file.
    //
    // A gate counts whether it is per-route or on the router — `billing.ts`
    // uses `billingRoutes.use("*", requireCapability("billing.manage"))`, which
    // covers six writes and looks like nothing at the call site. Reading only
    // the call site is how a reviewer concludes checkout is unprotected.
    const offenders: string[] = [];
    let writes = 0;
    for (const { name, src } of routeSources()) {
      const routerGate =
        /\.use\(\s*"\*"\s*,\s*requireCapability\("([^"]+)"\)/.test(src);
      for (const match of src.matchAll(
        /\.(post|patch|put|delete)\(\s*"([^"]+)"\s*,([\s\S]{0,140}?)(?=async|\()/g,
      )) {
        writes += 1;
        const [, method, path, between] = match;
        if (routerGate || between.includes("requireCapability")) continue;
        const route = `${method.toUpperCase()} ${path}`;
        if (route in UNGATED_WRITES) continue;
        offenders.push(`${name}: ${route}`);
      }
    }
    expect(
      offenders,
      "These change state and ask for no capability at all — not per route, " +
        "not on the router. Either gate them, or add them to UNGATED_WRITES " +
        "with which of the three reasons applies (public, pre-company, or the " +
        "caller's own):\n  " + offenders.join("\n  "),
    ).toEqual([]);
    // Guard the guard: a change in how routes are declared would otherwise
    // empty this silently, and an empty scan is a passing one.
    expect(writes).toBeGreaterThan(100);
  });

  it("the ungated list has no entries that stopped existing (#519)", () => {
    // Same reason SELF_SCOPED_WRITES has this: an exemption that outlives its
    // route is pre-approval for whatever takes the name next.
    const declared = new Set<string>();
    for (const { src } of routeSources()) {
      for (const match of src.matchAll(
        /\.(post|patch|put|delete)\(\s*"([^"]+)"/g,
      )) {
        declared.add(`${match[1].toUpperCase()} ${match[2]}`);
      }
    }
    const stale = Object.keys(UNGATED_WRITES).filter((r) => !declared.has(r));
    expect(
      stale,
      `UNGATED_WRITES names routes that no longer exist: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
