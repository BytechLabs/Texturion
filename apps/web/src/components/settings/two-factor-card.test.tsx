import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MfaState } from "@/lib/api/mfa";

/**
 * #314 — the two-factor card.
 *
 * The issue's devil's advocate is right that the real risk is lockout, not
 * friction, so what these pin is the anti-lockout copy: that somebody with no
 * recovery codes left is told to fix it rather than shown a statistic, and
 * that the not-enrolled state says what the setup actually involves before
 * asking for a commitment.
 */

let state: MfaState = {
  factors: [],
  enrolled: false,
  recovery_codes_remaining: 0,
  aal: "aal1",
};

vi.mock("@/lib/api/mfa", () => ({
  useMfa: () => ({ isPending: false, data: state, refetch: vi.fn() }),
  useIssueRecoveryCodes: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({ auth: { mfa: {} } }),
}));

import { TwoFactorCard } from "./two-factor-card";

const render = () => renderToStaticMarkup(<TwoFactorCard />);

describe("TwoFactorCard", () => {
  it("says what a stolen password actually costs, not that MFA is best practice", () => {
    state = { ...state, enrolled: false };
    // The reason to turn this on is specific to this product: somebody texting
    // your customers as you. Generic security copy gets skipped.
    expect(render()).toContain("texting your customers as you");
  });

  it("tells somebody what setup involves before asking them to start", () => {
    state = { ...state, enrolled: false };
    const html = render();
    expect(html).toContain("authenticator app");
    // And that backup codes are coming — the thing that makes it safe to do.
    expect(html).toContain("backup codes");
  });

  it("shows how many recovery codes are left once enrolled", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 7,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("Authenticator app is on");
    expect(html).toContain("7 recovery");
  });

  it("treats zero recovery codes as something to fix, not a number to read", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 0,
      aal: "aal2",
    };
    // Nought left is a lockout waiting for a lost phone.
    expect(render()).toContain("No recovery codes left");
  });

  it("offers a way to re-issue codes without turning the factor off", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 2,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("New recovery codes");
    expect(html).toContain("Turn off");
  });
});

/**
 * #473 — the passkey half.
 *
 * The card renders in the `node` environment, so `window` is absent and the
 * passkey path is off by default — which is itself the first assertion: a browser
 * that cannot do WebAuthn must not be offered a button that opens nothing, and
 * Safari on an old iPad in a work van is a real device.
 */
describe("TwoFactorCard — passkeys (#473)", () => {
  function withWebAuthn<T>(body: () => T): T {
    const had = "window" in globalThis;
    // Only what the card actually feature-tests. A fuller fake would be a fake
    // of a thing this test does not exercise.
    (globalThis as { window?: unknown }).window = {
      PublicKeyCredential: function PublicKeyCredential() {},
      location: { hostname: "app.loonext.com", origin: "https://app.loonext.com" },
    };
    try {
      return body();
    } finally {
      if (!had) delete (globalThis as { window?: unknown }).window;
    }
  }

  it("offers no passkey button where the browser cannot do it", () => {
    state = { factors: [], enrolled: false, recovery_codes_remaining: 0, aal: "aal1" };
    const html = render();
    expect(html).not.toContain("Use a passkey");
    // And the authenticator path is still fully explained, not reduced to a
    // fallback nobody was told about.
    expect(html).toContain("authenticator app");
    expect(html).toContain("backup codes");
  });

  it("leads with the passkey where the browser can, and still offers the app", () => {
    state = { factors: [], enrolled: false, recovery_codes_remaining: 0, aal: "aal1" };
    const html = withWebAuthn(render);
    expect(html).toContain("Use a passkey");
    expect(html).toContain("Use an authenticator app");
    // The reason, in the reader's terms: no typing, and it does not leave the
    // device. Plus the promise that makes it safe to do at all.
    expect(html).toContain("face, fingerprint or screen lock");
    expect(html).toContain("backup codes");
  });

  it("names a passkey as what is on, rather than saying authenticator app", () => {
    // The acceptance criterion that `GET /v1/mfa` distinguishes the types, read
    // by the person it is about. Saying "Authenticator app is on" to somebody who
    // enrolled a passkey is a wrong answer to "what happens if I lose this
    // phone".
    state = {
      factors: [{ id: "f1", type: "webauthn", name: "Passkey", created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 8,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("Passkey is on");
    expect(html).not.toContain("Authenticator app is on");
  });

  it("names both when both are enrolled", () => {
    state = {
      factors: [
        { id: "f1", type: "webauthn", name: "Passkey", created_at: null },
        { id: "f2", type: "totp", name: null, created_at: null },
      ],
      enrolled: true,
      recovery_codes_remaining: 8,
      aal: "aal2",
    };
    expect(render()).toContain("Passkey and authenticator app are on");
  });

  /*
   * #473 — the state above had NO ROUTE TO IT until 2026-08-16, and the test
   * that asserted its copy passed the whole time.
   *
   * `enrolled` is `factors.length > 0`, and the enrolment controls lived in
   * the other branch of that ternary. So one factor hid the way to the second:
   * a member with an authenticator app could never add a passkey, and a member
   * with a passkey could never add the app. The issue's second acceptance
   * criterion asks for exactly that pairing.
   *
   * A label test could not catch it, because the label was fine — it was the
   * PATH that was missing. These assert the path.
   */
  it("offers the passkey to somebody who only has an authenticator app", () => {
    state = {
      factors: [{ id: "f1", type: "totp", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 8,
      aal: "aal2",
    };
    // Through the WebAuthn stub: the passkey option is feature-gated on the
    // browser being able to do it, so without this the card is right to hide
    // it and the test would be asserting the wrong absence.
    const html = withWebAuthn(() => render());
    expect(html).toContain("Add a passkey");
    // And not the one they already hold — an option that does not apply is
    // absent rather than disabled.
    expect(html).not.toContain("Add an authenticator app");
  });

  it("offers the authenticator app to somebody who only has a passkey", () => {
    state = {
      factors: [{ id: "f1", type: "webauthn", name: "Passkey", created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 8,
      aal: "aal2",
    };
    const html = withWebAuthn(() => render());
    expect(html).toContain("Add an authenticator app");
    expect(html).not.toContain("Add a passkey");
  });

  it("offers neither once both are held", () => {
    state = {
      factors: [
        { id: "f1", type: "webauthn", name: "Passkey", created_at: null },
        { id: "f2", type: "totp", name: null, created_at: null },
      ],
      enrolled: true,
      recovery_codes_remaining: 8,
      aal: "aal2",
    };
    const html = withWebAuthn(() => render());
    expect(html).not.toContain("Add a passkey");
    expect(html).not.toContain("Add an authenticator app");
  });

  it("falls back to a true sentence for a factor type it does not name", () => {
    // `phone` is a factor type the platform supports and this card has no copy
    // for. Better to say the true general thing than to guess wrong about which
    // device holds the key.
    state = {
      factors: [{ id: "f1", type: "phone", name: null, created_at: null }],
      enrolled: true,
      recovery_codes_remaining: 3,
      aal: "aal2",
    };
    const html = render();
    expect(html).toContain("Two-factor authentication is on");
    expect(html).not.toContain("Passkey is on");
  });

  it("removes a passkey with the same button that removes everything else", () => {
    // Acceptance: recovery codes remove a passkey exactly as they remove TOTP,
    // and so does turning it off. The loop is over `factors` and has never cared
    // about the type — pinned here so a type-specific branch cannot creep in and
    // leave one factor behind, which would be two-factor still on after somebody
    // was told it was off.
    const source = readFileSync(
      join(import.meta.dirname, "two-factor-card.tsx"),
      "utf8",
    );
    const turnOff = source.slice(source.indexOf("async function turnOff"));
    const body = turnOff.slice(0, turnOff.indexOf("\n  }"));
    expect(body).toContain("of mfa.data?.factors");
    expect(body).not.toMatch(/type\s*===/);
  });
});
