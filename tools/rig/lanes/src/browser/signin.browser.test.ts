/**
 * The lane's member steps in a real Chromium against a stand-in app: a page
 * that sends a signed-out browser to /login?next=..., a login form whose
 * submit button starts disabled (as Turnstile leaves it), and the push card
 * from /settings/notifications. Run with `pnpm --filter @loonext/rig-lanes test:browser`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numberBook, writeFakeMicWavs } from "@loonext/rig-robot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserLane } from "./lane.ts";

const MEMBER = { email: "qa-w-owner@example.test", password: "a-test-password" };

const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><title>login</title>
<form method="post">
  <input type="email" name="email">
  <input type="password" name="password">
  <p id="error" hidden role="alert">Wrong email or password.</p>
  <button type="submit" disabled>Log in</button>
</form>
<script>
setTimeout(() => { document.querySelector("button").disabled = false; }, 400);
document.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("input[type=email]").value;
  const password = document.querySelector("input[type=password]").value;
  if (email !== ${JSON.stringify(MEMBER.email)} || password !== ${JSON.stringify(MEMBER.password)}) {
    document.getElementById("error").hidden = false;
    return;
  }
  document.cookie = "session=ok; path=/; max-age=86400";
  location.replace(new URLSearchParams(location.search).get("next") || "/");
});
</script>`;

const pushPage = (works: boolean) => `<!doctype html><meta charset="utf-8"><title>notifications</title>
<div><p>Email</p><button>Turn on</button></div>
<div class="card"><div><p>Push on this device</p><p>Get a buzz for new texts.</p></div><button id="push">Turn on</button></div>
<script>
document.getElementById("push").addEventListener("click", () => {
  if (${works}) setTimeout(() => { document.getElementById("push").textContent = "Turn off"; }, 200);
});
</script>`;

let server: Server;
let origin: string;
let logins = 0;
let pushWorks = true;
const dir = mkdtempSync(join(tmpdir(), "rig-lane-signin-"));

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const signedIn = (request.headers.cookie ?? "").includes("session=ok");
    if (url.pathname === "/login") {
      logins++;
      response.writeHead(200, { "content-type": "text/html" }).end(LOGIN_PAGE);
    } else if (!signedIn) {
      response.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname)}` }).end();
    } else if (url.pathname === "/settings/notifications") {
      response.writeHead(200, { "content-type": "text/html" }).end(pushPage(pushWorks));
    } else {
      response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>app</title><p>Signed in at ${url.pathname}</p>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  writeFakeMicWavs(join(dir, "mic"));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const lane = (profiles: string, password = MEMBER.password) =>
  new BrowserLane({
    appOrigin: origin,
    profilesDir: join(dir, profiles),
    fakeMicDir: join(dir, "mic"),
    numbers: numberBook({}),
    credentials: (member) => (member === "qa-w-owner" ? { email: MEMBER.email, password } : undefined),
  });

describe("a member's browser profile", () => {
  it("signs in on the app's login page once, lands where it was going, and stays signed in", async () => {
    const first = lane("profiles");
    try {
      const page = await first.open("qa-w-owner", "qa-w-owner", "/inbox");
      expect(new URL(page.page.url()).pathname).toBe("/inbox");
      expect(await page.page.textContent("p")).toBe("Signed in at /inbox");
    } finally {
      await first.closeAll();
    }
    expect(logins).toBe(1);
    const again = lane("profiles");
    try {
      const page = await again.open("qa-w-owner", "qa-w-owner", "/calls");
      expect(await page.page.textContent("p")).toBe("Signed in at /calls");
    } finally {
      await again.closeAll();
    }
    expect(logins).toBe(1);
  });

  it("says why it could not sign in, and never with the password", async () => {
    const wrong = lane("profiles-wrong", "not-the-password");
    try {
      const opened = wrong.open("qa-w-owner", "qa-w-owner", "/inbox");
      await expect(opened).rejects.toThrow(/qa-w-owner could not sign in \(Wrong email or password\.\)/);
      await expect(opened).rejects.not.toThrow(/not-the-password/);
      await expect(wrong.open("qa-e-owner", "qa-w-owner", "/inbox")).rejects.toThrow(/asks qa-e-owner to sign in, and the rig has no sign-in for them/);
    } finally {
      await wrong.closeAll();
    }
  });

  it("turns push on from the settings card, and says so when the browser cannot", async () => {
    const browser = lane("profiles-push");
    try {
      const page = await browser.open("qa-w-owner", "qa-w-owner", "/inbox");
      pushWorks = true;
      expect(await page.enablePush()).toBe(true);
      pushWorks = false;
      expect(await page.enablePush()).toBe(false);
      expect(new URL(page.page.url()).pathname).toBe("/inbox");
    } finally {
      await browser.closeAll();
    }
  });
});
