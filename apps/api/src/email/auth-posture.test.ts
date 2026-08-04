/**
 * #252 — the authentication posture, re-checked rather than remembered.
 *
 * AP-3 is the one that decides whether this is worth having. Every failure of
 * the CHECKER must be silent: a resolver that times out, rate-limits us, or
 * answers badly says nothing whatever about our DNS, and an ops alert that
 * fires on the checker's own bad day is an alert somebody learns to ignore —
 * which costs more than the gap it was watching. "Absent" and "could not ask"
 * are different answers and only one of them is a finding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  postureAlertText,
  postureProblems,
  readAuthPosture,
  sendingDomain,
  shouldAlertNow,
  POSTURE_ALERT_HOUR_UTC,
  type AuthPosture,
} from "./auth-posture";
import { stubFetch, type FetchRoute } from "../test/support";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A DoH JSON answer for one host. `null` = NXDOMAIN, `false` = server error. */
function doh(answers: Record<string, string | null | false>) {
  const route: FetchRoute = (url) => {
    if (url.origin !== "https://cloudflare-dns.com") return undefined;
    const name = url.searchParams.get("name") ?? "";
    const value = answers[name];
    if (value === false) {
      return Response.json({ Status: 2 }); // SERVFAIL
    }
    if (value === null || value === undefined) {
      return Response.json({ Status: 3 }); // NXDOMAIN — a real "absent"
    }
    return Response.json({
      Status: 0,
      Answer: [{ type: 16, data: `"${value}"` }],
    });
  };
  stubFetch(route);
}

describe("#252 email authentication posture", () => {
  it("AP-1: reads the three records the deploy doc records", async () => {
    doh({
      "loonext.com": "v=spf1 include:amazonses.com ~all",
      "resend._domainkey.loonext.com": "p=MIGfMA0GCSq",
      "_dmarc.loonext.com": "v=DMARC1; p=none; rua=mailto:dmarc@loonext.com",
    });
    const posture = await readAuthPosture("loonext.com");
    expect(posture.spf.value).toContain("v=spf1");
    expect(posture.dkim.value).toContain("p=MIG");
    expect(posture.dmarc.value).toContain("v=DMARC1");
    expect(postureProblems(posture)).toEqual([]);
  });

  it("AP-2: an absent DMARC is a finding, and says what to do about it", async () => {
    // Today's real state, per docs/deploy §4b — and the whole reason for this
    // file: a gap somebody has to go and act on is exactly the kind that gets
    // forgotten, and its failure is silent for months and then total.
    doh({
      "loonext.com": "v=spf1 include:amazonses.com ~all",
      "resend._domainkey.loonext.com": "p=MIGfMA0GCSq",
      "_dmarc.loonext.com": null,
    });
    const posture = await readAuthPosture("loonext.com");
    const problems = postureProblems(posture);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/DMARC is absent/);

    // The alert carries the exact record to add and the command to re-check,
    // because an ops message that only says something is wrong makes the
    // reader go and find out what to type.
    const text = postureAlertText(posture, problems);
    expect(text).toContain('"v=DMARC1; p=none; rua=mailto:dmarc@loonext.com"');
    expect(text).toContain("nslookup -type=TXT _dmarc.loonext.com");
    // And it says plainly whose job this is, since no token here can do it.
    expect(text).toMatch(/founder action/i);
  });

  it("AP-3: a resolver we could not reach is never a finding", async () => {
    // THE ONE THAT MATTERS. SERVFAIL, a timeout and an HTTP error all mean
    // "we did not get to ask" — which says nothing about our DNS. Reporting
    // them would fire this alert on the checker's own bad day.
    doh({
      "loonext.com": false,
      "resend._domainkey.loonext.com": false,
      "_dmarc.loonext.com": false,
    });
    const posture = await readAuthPosture("loonext.com");
    expect(posture.dmarc.resolved).toBe(false);
    expect(postureProblems(posture)).toEqual([]);

    // A fetch that throws outright is the same answer.
    stubFetch(() => {
      throw new Error("network down");
    });
    const thrown = await readAuthPosture("loonext.com");
    expect(thrown.dmarc.resolved).toBe(false);
    expect(postureProblems(thrown)).toEqual([]);
  });

  it("AP-4: a TXT set with other records in it is not a posture", async () => {
    // A domain's TXT set holds site-verification strings and whatever else
    // somebody pasted in. Only the policy record counts, and treating a Google
    // verification token as an SPF record would report a real gap as sound.
    doh({
      "loonext.com": "google-site-verification=abc123",
      "resend._domainkey.loonext.com": "p=MIGfMA0GCSq",
      "_dmarc.loonext.com": "some-unrelated-note",
    });
    const posture = await readAuthPosture("loonext.com");
    expect(posture.spf.value).toBeNull();
    expect(posture.dmarc.value).toBeNull();
    const problems = postureProblems(posture);
    expect(problems.some((p) => /DMARC is absent/.test(p))).toBe(true);
    expect(problems.some((p) => /SPF is absent/.test(p))).toBe(true);
  });

  it("AP-5: a long DKIM key split across TXT chunks is not reported as missing", async () => {
    // DoH splits TXT strings over 255 characters into several quoted chunks.
    // Reading only the first would report a perfectly good key as malformed,
    // and DKIM is the record that survives forwarding.
    const route: FetchRoute = (url) => {
      if (url.origin !== "https://cloudflare-dns.com") return undefined;
      const name = url.searchParams.get("name") ?? "";
      if (name !== "resend._domainkey.loonext.com") {
        return Response.json({ Status: 3 });
      }
      return Response.json({
        Status: 0,
        Answer: [{ type: 16, data: `"p=${"A".repeat(255)}" "${"B".repeat(60)}"` }],
      });
    };
    stubFetch(route);
    const posture = await readAuthPosture("loonext.com");
    expect(posture.dkim.value).toHaveLength(2 + 255 + 60);
    expect(posture.dkim.value?.endsWith("B")).toBe(true);
  });

  it("AP-6: the domain comes off whatever shape RESEND_FROM is in", () => {
    expect(sendingDomain("Loonext <noreply@loonext.com>")).toBe("loonext.com");
    expect(sendingDomain("noreply@loonext.com")).toBe("loonext.com");
    expect(sendingDomain("  NoReply@LooNext.COM ")).toBe("loonext.com");
    // Nothing to check is a skip, never a lookup for a name that cannot exist.
    expect(sendingDomain(null)).toBeNull();
    expect(sendingDomain("")).toBeNull();
    expect(sendingDomain("not-an-address")).toBeNull();
    expect(sendingDomain("someone@localhost")).toBeNull();
  });

  it("AP-7: it speaks once a day, not once an hour", () => {
    // The job it rides is hourly. The gap it watches takes days to close, so
    // twenty-four identical messages would arrive before anybody could act on
    // the first — and the mailbox that cries wolf is the one whose next
    // message goes unread.
    const at = (hour: number) => new Date(Date.UTC(2026, 7, 4, hour, 0, 0));
    expect(shouldAlertNow(at(POSTURE_ALERT_HOUR_UTC))).toBe(true);
    const spoke = [...Array(24).keys()].filter((hour) => shouldAlertNow(at(hour)));
    expect(spoke).toHaveLength(1);
  });

  it("AP-8: a sound posture says nothing at all", () => {
    // The pair for AP-2. A check that always finds something is a check
    // nobody reads.
    const sound: AuthPosture = {
      domain: "loonext.com",
      spf: { host: "loonext.com", value: "v=spf1 include:amazonses.com ~all", resolved: true },
      dkim: { host: "resend._domainkey.loonext.com", value: "p=MIG", resolved: true },
      dmarc: { host: "_dmarc.loonext.com", value: "v=DMARC1; p=none", resolved: true },
    };
    expect(postureProblems(sound)).toEqual([]);
  });
});
