import { describe, expect, it, vi } from "vitest";

import {
  buildContactRequestBody,
  buildMailto,
  contactEndpoint,
  CONTACT_MIN_MESSAGE,
  CONTACT_NETWORK_ERROR,
  hasFieldErrors,
  isValidEmail,
  messageForErrorCode,
  submitContact,
  validateContactForm,
  type ContactFormValues,
} from "./contact-form-logic";

function values(overrides: Partial<ContactFormValues> = {}): ContactFormValues {
  return {
    name: "Dale Reyes",
    email: "dale@reyesplumbing.com",
    message: "My water heater quote question, can you help?",
    company: "Reyes Plumbing",
    website: "",
    ...overrides,
  };
}

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("dale@example.com")).toBe(true);
  });

  it("rejects missing @, missing domain dot, and spaces", () => {
    expect(isValidEmail("dale")).toBe(false);
    expect(isValidEmail("dale@example")).toBe(false);
    expect(isValidEmail("dale @example.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("validateContactForm", () => {
  it("passes a complete, valid submission", () => {
    expect(validateContactForm(values())).toEqual({});
    expect(hasFieldErrors(validateContactForm(values()))).toBe(false);
  });

  it("flags a blank (whitespace-only) name", () => {
    expect(validateContactForm(values({ name: "   " })).name).toBeDefined();
  });

  it("flags a missing and a malformed email distinctly", () => {
    expect(validateContactForm(values({ email: "" })).email).toBe(
      "Please enter your email address.",
    );
    expect(validateContactForm(values({ email: "nope" })).email).toBe(
      "Please enter a valid email address.",
    );
  });

  it(`flags a message shorter than ${CONTACT_MIN_MESSAGE} characters (after trim)`, () => {
    expect(validateContactForm(values({ message: "too short" })).message).toBeDefined();
    // Whitespace padding does not satisfy the minimum.
    expect(
      validateContactForm(values({ message: "  hi      " })).message,
    ).toBeDefined();
  });

  it("does not require the optional company or the honeypot", () => {
    expect(
      hasFieldErrors(validateContactForm(values({ company: "", website: "" }))),
    ).toBe(false);
  });
});

describe("buildContactRequestBody", () => {
  it("trims text fields and includes a non-empty company", () => {
    expect(
      buildContactRequestBody(
        values({ name: "  Dale  ", email: " dale@x.com ", company: "  Acme " }),
      ),
    ).toEqual({
      name: "Dale",
      email: "dale@x.com",
      message: "My water heater quote question, can you help?",
      company: "Acme",
      website: "",
    });
  });

  it("omits company entirely when blank (server sees an absent optional)", () => {
    const body = buildContactRequestBody(values({ company: "   " }));
    expect(body).not.toHaveProperty("company");
  });

  it("passes the honeypot value through verbatim (client never drops it)", () => {
    expect(buildContactRequestBody(values({ website: "http://spam.example" })).website).toBe(
      "http://spam.example",
    );
    // Turnstile is not configured on web; the body never carries a token.
    expect(buildContactRequestBody(values())).not.toHaveProperty("turnstileToken");
  });
});

describe("contactEndpoint", () => {
  it("targets /contact at the API root, not under /v1", () => {
    expect(contactEndpoint("https://api.loonext.com")).toBe(
      "https://api.loonext.com/contact",
    );
  });

  it("does not double the slash when the base has a trailing one", () => {
    expect(contactEndpoint("https://api.loonext.com/")).toBe(
      "https://api.loonext.com/contact",
    );
  });
});

describe("messageForErrorCode", () => {
  it("maps rate_limited (and a 429 with no code) to the try-later copy", () => {
    expect(messageForErrorCode("rate_limited")).toMatch(/try again in a little while/i);
    expect(messageForErrorCode(undefined, 429)).toMatch(/try again in a little while/i);
  });

  it("maps validation_failed (and its 422 status) to the check-the-fields copy", () => {
    expect(messageForErrorCode("validation_failed")).toMatch(/check the fields/i);
    expect(messageForErrorCode(undefined, 422)).toMatch(/check the fields/i);
  });

  it("falls back to a generic sentence for anything else", () => {
    expect(messageForErrorCode("internal_error", 500)).toMatch(/went wrong/i);
    expect(messageForErrorCode(undefined, undefined)).toMatch(/went wrong/i);
  });

  it("never surfaces a raw code or object", () => {
    for (const code of ["rate_limited", "validation_failed", "boom", undefined]) {
      const msg = messageForErrorCode(code);
      expect(msg).not.toContain("undefined");
      expect(msg).not.toMatch(/\{|\}|code:/);
    }
  });
});

describe("submitContact", () => {
  function response(status: number, body?: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
    } as unknown as Response;
  }

  it("POSTs JSON to the endpoint with Content-Type and the built body", async () => {
    const fetchImpl = vi.fn(async () => response(201, { ok: true }));
    const result = await submitContact(values(), {
      apiBaseUrl: "https://api.loonext.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.loonext.com/contact");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "Dale Reyes",
      email: "dale@reyesplumbing.com",
      website: "",
    });
  });

  it("maps a 429 to the rate-limit sentence", async () => {
    const fetchImpl = vi.fn(async () =>
      response(429, { error: { code: "rate_limited", message: "slow down" } }),
    );
    const result = await submitContact(values(), {
      apiBaseUrl: "https://api.loonext.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/try again in a little while/i),
    });
  });

  it("maps a 422 validation error to the check-the-fields sentence", async () => {
    const fetchImpl = vi.fn(async () =>
      response(422, { error: { code: "validation_failed", message: "bad" } }),
    );
    const result = await submitContact(values(), {
      apiBaseUrl: "https://api.loonext.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/check the fields/i),
    });
  });

  it("returns the network-error copy when fetch throws (never rejects)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await submitContact(values(), {
      apiBaseUrl: "https://api.loonext.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, message: CONTACT_NETWORK_ERROR });
  });

  it("still maps by status when the error body is unparseable", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 429,
          json: async () => {
            throw new SyntaxError("Unexpected end of JSON input");
          },
        }) as unknown as Response,
    );
    const result = await submitContact(values(), {
      apiBaseUrl: "https://api.loonext.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/try again in a little while/i),
    });
  });
});

describe("buildMailto (fallback link)", () => {
  it("percent-encodes per RFC 6068 (spaces are %20, never +)", () => {
    const href = buildMailto(
      "Dale Reyes",
      "Reyes Plumbing",
      "My water heater quote question",
    );
    expect(href).toContain("mailto:support@loonext.com?subject=");
    expect(href).toContain("subject=Loonext%20question%20from%20Dale%20Reyes");
    expect(href).toContain("body=My%20water%20heater%20quote%20question");
    expect(href).not.toContain("+");
    expect(href).toContain("%0A%0ADale%20Reyes%2C%20Reyes%20Plumbing");
  });

  it("omits the signature block when name and business are empty", () => {
    const href = buildMailto("", "", "Question about porting");
    expect(href).toContain("subject=Loonext%20question&");
    expect(href).toContain("body=Question%20about%20porting");
    expect(href).not.toContain("%0A");
    expect(href).not.toContain("+");
  });
});
