import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../context";
import { PUBLIC_PAGE_HEADERS } from "../public-links/guard";
import {
  API_SECURITY_HEADERS,
  DEFAULT_CACHE_CONTROL,
  securityHeaders,
} from "./security-headers";

/**
 * #586 — the API Worker sent no security response headers at all.
 *
 * Measured on the wire on 2026-08-09, not inferred: neither `GET /health` (200) nor
 * `GET /v1/conversations` (401) carried `Cache-Control`, `X-Content-Type-Options`,
 * `Referrer-Policy` or HSTS, with or without a bearer token, and Cloudflare added none
 * in front. The absence of a module is not something a code search surfaces.
 */

function appWith(handler: (app: Hono<AppEnv>) => void) {
  const app = new Hono<AppEnv>();
  app.use("*", securityHeaders());
  handler(app);
  return app;
}

describe("what every API response now carries", () => {
  it("marks an authenticated response non-storable", async () => {
    // THE ONE THAT MATTERS. A `/v1` response is one customer's conversations, and
    // nothing marked it as such — a shared cache or an intermediary would have been
    // within its rights to keep a copy of it.
    const app = appWith((a) => a.get("/v1/conversations", (c) => c.json({ data: [] })));

    const res = await app.request("/v1/conversations");

    expect(res.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("sends nosniff and no referrer, on a 200 and on a failure alike", async () => {
    // The measurement found a bare 401 as well as a bare 200, and an error body is
    // still JSON somebody's browser will look at.
    const app = appWith((a) => {
      a.get("/ok", (c) => c.json({ ok: true }));
      a.get("/nope", (c) => c.json({ error: "no" }, 401));
    });

    for (const path of ["/ok", "/nope"]) {
      const res = await app.request(path);
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy"), path).toBe("no-referrer");
    }
  });

  it("sends its own HSTS, because the apex is NOT on the preload list", async () => {
    /**
     * The assumption was that the apex's `includeSubDomains; preload` covered this
     * host. Half right, and the wrong half is the one that reads as reassuring.
     *
     * `includeSubDomains` does cover `api.loonext.com` — but only for a browser that
     * has already been to the apex. And `preload` in a header is an ELIGIBILITY
     * ASSERTION, not membership: `hstspreload.org/api/v2/status?domain=loonext.com`
     * answered `"status": "unknown"` on 2026-08-09, so the domain has never been
     * submitted. This host says it for itself, and without `preload`, because
     * claiming eligibility we have not claimed is the same mistake one level down.
     */
    const app = appWith((a) => a.get("/health", (c) => c.json({ ok: true })));

    const hsts = (await app.request("/health")).headers.get(
      "Strict-Transport-Security",
    );

    expect(hsts).toContain("includeSubDomains");
    expect(Number(/max-age=(\d+)/.exec(hsts ?? "")?.[1] ?? 0)).toBeGreaterThanOrEqual(
      31536000,
    );
    expect(hsts, "we are not on the preload list; do not assert eligibility").not.toContain(
      "preload",
    );
  });

  it("claims nothing about rendering, because nothing here renders", () => {
    // A longer header list reads as more protection. Frame and popup policies govern
    // documents; this Worker returns JSON, and shipping them would be decoration.
    for (const key of [
      "X-Frame-Options",
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Permissions-Policy",
    ]) {
      expect(API_SECURITY_HEADERS, key).not.toHaveProperty(key);
    }
  });
});

describe("the two routes that decide for themselves", () => {
  it("leaves the public page's own Cache-Control alone", async () => {
    // A shared job-photos page sets its own — same meaning, its own spelling — beside
    // the robots and referrer headers it needs. Overwriting it would be churn at best.
    const app = appWith((a) =>
      a.get("/photos/:token", (c) => {
        for (const [key, value] of Object.entries(PUBLIC_PAGE_HEADERS)) {
          c.header(key, value);
        }
        return c.json({ photos: [] });
      }),
    );

    const res = await app.request("/photos/abc");

    expect(res.headers.get("Cache-Control")).toBe(
      PUBLIC_PAGE_HEADERS["Cache-Control"],
    );
    expect(res.headers.get("X-Robots-Tag")).toBe(PUBLIC_PAGE_HEADERS["X-Robots-Tag"]);
  });

  it("leaves the app-release endpoint publicly cacheable", async () => {
    /**
     * THE ONE A DEFAULT WOULD HAVE BROKEN SILENTLY.
     *
     * Every client reads the update policy on every cold start, and 300 seconds of
     * public caching is the difference between a free lookup and a database round trip
     * per launch. A blanket `private, no-store` would have made it uncacheable and
     * nothing would have failed — just a quiet per-launch cost nobody attributes.
     */
    const app = appWith((a) =>
      a.get("/v1/app-release", (c) => {
        c.header("Cache-Control", "public, max-age=300");
        return c.json({ minimum: "1.0.0" });
      }),
    );

    const res = await app.request("/v1/app-release");

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});

describe("the layer is actually mounted", () => {
  /**
   * The failure mode this whole issue is about is invisible from the outside: a
   * middleware that silently stops being applied returns exactly what it returned
   * before, just without the headers. Every test above builds its own app, so none of
   * them would notice the real one losing it.
   */
  it("wraps every route in the Worker, not just /v1", () => {
    const index = readFileSync(
      join(import.meta.dirname, "..", "index.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(index).toContain('app.use("*", securityHeaders());');
    // Before the routes, or it wraps nothing that matters.
    const mounted = index.indexOf('app.use("*", securityHeaders());');
    const firstRoute = index.indexOf("app.route(");
    expect(mounted).toBeGreaterThan(-1);
    expect(firstRoute).toBeGreaterThan(-1);
    expect(
      mounted,
      "the headers layer must be registered before the routes it wraps",
    ).toBeLessThan(firstRoute);
  });

  it("covers the surfaces the production probe found bare", () => {
    // `/health` and the webhook routes are mounted OUTSIDE the /v1 chain, and the
    // measurement found `/health` bare too. `"*"` is the only scope that reaches them.
    const index = readFileSync(
      join(import.meta.dirname, "..", "index.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const scope = /app\.use\((["'])(.+?)\1,\s*securityHeaders\(\)\)/.exec(index);
    expect(scope?.[2], "a narrower scope leaves /health and /webhooks bare").toBe("*");
  });
});
