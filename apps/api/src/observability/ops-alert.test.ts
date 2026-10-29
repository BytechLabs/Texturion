/**
 * The ops channel (D139).
 *
 * Every property asserted here is something that shipped wrong in the alert
 * the founder reported: customer chrome on an internal diagnostic, a
 * `support@loonext.com` default, and no grouping identity. The fingerprint is
 * the load-bearing one — it is what makes "mute this one key" a sentence the
 * operator can say.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { completeEnv, stubFetch } from "../test/support";
import {
  opsCaptures,
  resetSentryCaptures,
  sentryCaptures,
} from "../test/sentry-mock";
import { opsAlert, opsBodyHtml, opsEmail } from "./ops-alert";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

interface SentMail {
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
}

/** Captures what reached Resend; `failing` makes the send blow up. */
function world(options: { failing?: boolean } = {}) {
  const mail: SentMail[] = [];
  stubFetch((url, request) => {
    if (url.host !== "api.resend.com") return undefined;
    if (options.failing) return new Response("upstream down", { status: 500 });
    return (async () => {
      mail.push((await request.clone().json()) as SentMail);
      return Response.json({ id: "email-1" });
    })();
  });
  return mail;
}

const env = completeEnv();

/** The same env with no ops recipient — a deployment that configured none. */
function envWithoutOpsEmail(): Env {
  const bare = completeEnv();
  delete bare.OPS_ALERT_EMAIL;
  return bare;
}

beforeEach(() => {
  resetSentryCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every alert is a Sentry issue, grouped by key", () => {
  it("fingerprints on the key, so repeats collapse into one issue", async () => {
    world();
    await opsAlert(env, {
      key: "channel:telnyx-call-events",
      summary: "channel:telnyx-call-events has not happened",
      detail: "Last seen 23 days ago.",
    });

    expect(sentryCaptures).toHaveLength(1);
    const [alert] = sentryCaptures;
    expect(alert.fingerprint).toEqual(["ops", "channel:telnyx-call-events"]);
    expect(alert.tags.ops_key).toBe("channel:telnyx-call-events");
    expect(alert.message).toBe("channel:telnyx-call-events has not happened");
    expect(alert.extra.detail).toBe("Last seen 23 days ago.");
  });

  it("gives two problems two fingerprints, so one can be muted alone", async () => {
    // The fix for volume is not fewer alerts: it is silencing the noisy
    // heartbeat without silencing the sibling that shares its cron.
    world();
    await opsAlert(env, { key: "ops:a", summary: "first problem" });
    await opsAlert(env, { key: "ops:b", summary: "second problem" });

    expect(opsCaptures("ops:a")).toHaveLength(1);
    expect(opsCaptures("ops:b")).toHaveLength(1);
    expect(opsCaptures("ops:a")[0].fingerprint).not.toEqual(
      opsCaptures("ops:b")[0].fingerprint,
    );
  });

  it("defaults to warning and carries error through when asked", async () => {
    world();
    await opsAlert(env, { key: "ops:quiet", summary: "worth a look" });
    await opsAlert(env, {
      key: "ops:loud",
      summary: "worth waking up for",
      level: "error",
    });

    expect(opsCaptures("ops:quiet")[0].level).toBe("warning");
    expect(opsCaptures("ops:loud")[0].level).toBe("error");
  });

  it("records the first move, so the alert is actionable in Sentry alone", async () => {
    world();
    await opsAlert(env, {
      key: "ops:portout",
      summary: "a port-out was requested",
      action: "Confirm with the customer before it completes.",
    });

    expect(opsCaptures("ops:portout")[0].extra.action).toBe(
      "Confirm with the customer before it completes.",
    );
  });
});

describe("an unconfigured recipient is Sentry-only", () => {
  it("still records the alert, and mails absolutely nobody", async () => {
    // The removed fallback mailed `support@loonext.com` here. An unset
    // address is a configuration gap, not a reason to write to customers.
    const mail = world();
    await opsAlert(envWithoutOpsEmail(), {
      key: "ops:unconfigured",
      summary: "something is wrong",
    });

    expect(opsCaptures("ops:unconfigured")).toHaveLength(1);
    expect(mail).toEqual([]);
  });

  it("does not throw, because a cron must finish its work", async () => {
    const mail = world();
    await expect(
      opsEmail(envWithoutOpsEmail(), {
        key: "ops:unconfigured",
        subject: "[ops] something is wrong",
        text: "details",
      }),
    ).resolves.toBeUndefined();
    expect(mail).toEqual([]);
  });
});

describe("the email copy is not customer mail", () => {
  it("wears no account voice and names no support address", async () => {
    const mail = world();
    await opsAlert(env, {
      key: "ops:number-health",
      summary: "two numbers are degraded",
      detail: "+14165551234, +16135550000",
      action: "Check the Telnyx dashboard.",
    });

    expect(mail).toHaveLength(1);
    const [sent] = mail;
    const whole = `${sent.text}\n${sent.html}`;
    // BOTH MIME parts: the html came from `emailLayout` and the text was
    // appended centrally by `sendEmail`, so fixing one still shipped the other.
    expect(whole).not.toContain("support@loonext.com");
    expect(whole).not.toContain("service message about your Loonext account");
    expect(whole).not.toContain("flat-rate business texting");
  });

  it("says what it is, so the reader never mistakes it for customer mail", async () => {
    const mail = world();
    await opsAlert(env, { key: "ops:labelled", summary: "a problem" });

    expect(mail[0].html).toContain(
      "internal operational alert, not a customer message",
    );
    expect(mail[0].text).toContain("Key: ops:labelled");
  });

  it("goes only to the configured address, and replies go back there", async () => {
    const mail = world();
    await opsAlert(env, { key: "ops:routing", summary: "a problem" });

    expect(mail[0].to).toEqual([env.OPS_ALERT_EMAIL]);
    expect(mail[0].reply_to).toBe(env.OPS_ALERT_EMAIL);
  });

  it("carries the action into the body as a plain instruction", async () => {
    const mail = world();
    await opsAlert(env, {
      key: "ops:actionable",
      summary: "a problem",
      action: "Restart the consumer.",
    });

    expect(mail[0].text).toContain("What to do: Restart the consumer.");
    expect(mail[0].html).toContain("What to do: Restart the consumer.");
  });

  it("keeps a pre-built body, and still labels it", async () => {
    // The migrated senders carry real tables, and flattening those into one
    // `detail` string would cost the operator information they use.
    const mail = world();
    await opsAlert(env, {
      key: "ops:tabular",
      summary: "delivery by country",
      html: opsBodyHtml("<table><tr><td>CA</td><td>91%</td></tr></table>"),
    });

    expect(mail[0].html).toContain("<td>91%</td>");
    expect(mail[0].html).toContain(
      "internal operational alert, not a customer message",
    );
  });

  it("escapes a summary that contains markup", async () => {
    const mail = world();
    await opsAlert(env, {
      key: "ops:escaping",
      summary: "<script>alert(1)</script> broke",
    });

    expect(mail[0].html).not.toContain("<script>");
    expect(mail[0].html).toContain("&lt;script&gt;");
  });
});

describe("opsEmail keeps the migrated copy verbatim", () => {
  it("sends the caller's own subject and body, fingerprinted", async () => {
    const mail = world();
    await opsEmail(env, {
      key: "ops:email-deliverability",
      subject: "[ops] bounce rate is climbing",
      text: "4.2% over the last 24h, up from 0.9%.",
    });

    expect(mail[0].subject).toBe("[ops] bounce rate is climbing");
    expect(mail[0].text).toContain("4.2% over the last 24h");
    expect(opsCaptures("ops:email-deliverability")).toHaveLength(1);
    expect(opsCaptures("ops:email-deliverability")[0].message).toBe(
      "[ops] bounce rate is climbing",
    );
  });

  it("appends the key to a pre-built body without disturbing it", async () => {
    const mail = world();
    await opsEmail(env, {
      key: "ops:portout",
      subject: "[ops] port-out requested",
      text: "plain",
      html: opsBodyHtml("<p>A carrier asked for +14165551234.</p>"),
    });

    expect(mail[0].html).toContain("<p>A carrier asked for +14165551234.</p>");
    expect(mail[0].html).toContain("Key: ops:portout");
  });
});

describe("a failed alert never stops the work that raised it", () => {
  it("swallows a dead email channel, having already reached Sentry", async () => {
    // These run inside crons and webhook handlers. An alert that throws turns
    // "one thing is degraded" into "the job that would have told you failed".
    world({ failing: true });
    await expect(
      opsAlert(env, { key: "ops:resend-down", summary: "a problem" }),
    ).resolves.toBeUndefined();

    expect(opsCaptures("ops:resend-down")).toHaveLength(1);
  });

  it("still mails when Sentry itself refuses", async () => {
    const mail = world();
    const sentry = await import("@sentry/cloudflare");
    vi.mocked(sentry.withScope).mockImplementationOnce(() => {
      throw new Error("Sentry transport is down");
    });

    await expect(
      opsAlert(env, { key: "ops:sentry-down", summary: "a problem" }),
    ).resolves.toBeUndefined();
    expect(mail).toHaveLength(1);
  });
});

describe("one module owns the ops recipient", () => {
  // Converging nineteen hand-built senders is half the fix. This is the half
  // that stops the twentieth.
  const SRC = join(import.meta.dirname, "..");
  const OWNER = join("observability", "ops-alert.ts");
  // A READ of the binding, not a mention of it. The schema declares the key,
  // the test env sets it, and several comments name it — matching the bare
  // word made the rule fire on prose, which is the fastest way to a guard
  // somebody relaxes until it catches nothing.
  const READS_IT = /\benv\.OPS_ALERT_EMAIL\b/;

  function sources(): string[] {
    return readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
      .map((entry) => join(SRC, entry));
  }

  function readers(): string[] {
    return sources()
      .filter((path) => READS_IT.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));
  }

  it("reads the tree, so a passing run means something", () => {
    expect(sources().length).toBeGreaterThan(50);
  });

  it("nothing outside ops-alert.ts reads the ops recipient", () => {
    const offenders = readers().filter((rel) => rel !== OWNER);

    expect(
      offenders,
      `These read the ops recipient directly instead of calling opsAlert/` +
        `opsEmail, which is how an alert ends up with no Sentry record, no ` +
        `grouping key, or a support@ fallback: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("finds ops-alert.ts by that rule, so the sweep is not vacuous", () => {
    expect(readers()).toContain(OWNER);
  });

  // Every ops send that supplies its own HTML, as `builder` per call site.
  //
  // Windowed rather than per-file on purpose: two of these modules send to the
  // CUSTOMER as well as to ops from the same file, and `renderEmailHtml` is
  // right in one of those calls and wrong in the other.
  const OPS_HTML = /ops(?:Email|Alert)\(env,\s*\{[\s\S]{0,1400}?html:\s*([A-Za-z]+)\(/g;
  const OPS_HTML_BUILDERS = ["opsBodyHtml", "opsTextHtml", "overdueCardHtml"];

  function opsHtmlCallSites(): { file: string; builder: string }[] {
    return sources().flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(OPS_HTML)].map((match) => ({
        file: relative(SRC, path),
        builder: match[1],
      })),
    );
  }

  it("no ops send dresses itself in the customer layout", () => {
    // Thirteen ops senders reached the customer chrome through
    // `renderEmailHtml` without naming `emailLayout`, so fixing the four
    // obvious wrappers produced a clean-looking diff and left the rest signing
    // internal diagnostics as account mail. Counting conversions is not
    // coverage; this reads the result.
    const offenders = opsHtmlCallSites().filter(
      (site) => !OPS_HTML_BUILDERS.includes(site.builder),
    );

    expect(
      offenders,
      `These pass a CUSTOMER html builder to an ops send, which signs an ` +
        `internal alert "a service message about your Loonext account" and ` +
        `points its reply at support@: ` +
        offenders.map((o) => `${o.file} (${o.builder})`).join(", "),
    ).toEqual([]);
  });

  it("finds the ops senders that build their own html, so the sweep is real", () => {
    // A window regex that stops matching after a refactor passes vacuously.
    expect(opsHtmlCallSites().length).toBeGreaterThan(14);
  });

  it("no source still carries the support@ ops fallback", () => {
    const offenders = sources()
      .filter((path) =>
        /OPS_ALERT_EMAIL\s*\?\?|\?\?\s*"support@loonext\.com"/.test(
          readFileSync(path, "utf8"),
        ),
      )
      .map((path) => relative(SRC, path));

    expect(
      offenders,
      `A support@loonext.com fallback routes internal diagnostics into the ` +
        `queue customers write to: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("opsBodyHtml is the ops counterpart to emailLayout", () => {
  it("frames a body without borrowing the customer footer", () => {
    const html = opsBodyHtml("<p>inner</p>");
    expect(html).toContain("<p>inner</p>");
    expect(html).not.toContain("support@loonext.com");
    expect(html).not.toContain("service message about your Loonext account");
  });
});
