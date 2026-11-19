/**
 * #748: the website widget, end to end, in a real browser.
 *
 * A customer's page on one origin loads the pasted snippet from another, the
 * way an owner's site loads it from app.loonext.com. A visitor fills the form,
 * the code arrives by text through the carrier, and the message lands in the
 * workspace's inbox. The script is the file the web app serves, and the API is
 * the Worker itself, so the cross-origin preflight is answered by the real
 * CORS rules.
 */
import { readFileSync } from "node:fs";
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { join } from "node:path";

import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The line Settings hands an owner to paste, built by the web app's own code.
import { widgetSnippet } from "../../web/src/lib/marketing/widget-snippet";
import { GET as widgetChallenge } from "../../web/src/app/widget-challenge/route";
import { deleteCompaniesSql } from "./company-cleanup";
import { startHarness } from './harness';
import type { Harness } from './harness';

const OWNER_ID = "d31c0748-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0748-0002-4002-8002-000000000002";
const NUMBER_ID = "d31c0748-0003-4003-8003-000000000003";
const NUMBER_E164 = "+16045550148";
const VISITOR_E164 = "+16045550149";
const CAPTCHA_TOKEN = "widget-e2e-token";
const CAPTCHA_SECRET = "widget-e2e-secret";

const WIDGET_JS = readFileSync(join(import.meta.dirname, "..", "..", "web", "public", "widget.js"));
const CHALLENGE_JS = readFileSync(join(import.meta.dirname, "..", "..", "web", "public", "widget-challenge.js"));

let h: Harness;
let browser: Browser;
let customerSite: Server;
let loonext: Server;
let customerOrigin: string;
let loonextOrigin: string;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function cleanup(): void {
  h.sql(`
    ${h.clearAuditSql(COMPANY_ID)}
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversation_events where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.widget_verifications where company_id = '${COMPANY_ID}';
    delete from public.webhook_deliveries where company_id = '${COMPANY_ID}';
    delete from public.webhook_endpoints where company_id = '${COMPANY_ID}';
    delete from public.egress_events where company_id = '${COMPANY_ID}';
    delete from public.inbound_notification_days where company_id = '${COMPANY_ID}';
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    ${deleteCompaniesSql([COMPANY_ID])}
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

beforeAll(async () => {
  h = await startHarness();
  h.env.TURNSTILE_SECRET_KEY = CAPTCHA_SECRET;
  h.env.VERIFY_RATE_LIMITER = { limit: async () => ({ success: true }) };
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "widget-e2e-site-key");
  const fetchNetwork = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const fields = init?.body as URLSearchParams;
      return Response.json({ success: fields.get("response") === CAPTCHA_TOKEN && fields.get("secret") === CAPTCHA_SECRET });
    }
    return fetchNetwork(input, init);
  });
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@widget.test`, "Widget Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
       subscription_status, plan, current_period_start, current_period_end,
       aup_accepted_at)
    values ('${COMPANY_ID}', 'Harbour Plumbing', '${OWNER_ID}', 'CA', false, '604',
            'active', 'starter', now(), now() + interval '30 days', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'widget_${h.runId}', 'CA',
            '${NUMBER_E164}');

    insert into public.webhook_endpoints (company_id, url, secret, events)
    values ('${COMPANY_ID}', 'https://widget.example.test/hook', 'widget-e2e', array['message.received', 'contact.created']);
  `);
  const widgetKey = h.sql(`select widget_key from public.companies where id = '${COMPANY_ID}';`).trim();

  // Loonext's side: the script the web app serves, and the Worker behind it.
  loonext = createServer(async (req, res) => {
    if (req.url === "/widget.js" || req.url === "/widget-challenge.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(req.url === "/widget.js" ? WIDGET_JS : CHALLENGE_JS);
      return;
    }
    if (req.url?.startsWith("/widget-challenge?")) {
      const response = widgetChallenge(new Request(`${loonextOrigin}${req.url}`));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const response = await h.fetch(
      new Request(`https://api.loonext.com${req.url}`, { method: req.method, headers, body }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  loonextOrigin = await listen(loonext);

  // The customer's website, a different origin, with the snippet pasted in.
  customerSite = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Harbour Plumbing</title></head><body><h1>Harbour Plumbing</h1>
${widgetSnippet(loonextOrigin, widgetKey)}
</body></html>`);
  });
  customerOrigin = await listen(customerSite);

  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await browser?.close();
  await new Promise((resolve) => customerSite?.close(resolve));
  await new Promise((resolve) => loonext?.close(resolve));
  if (h) {
    cleanup();
    await h.close();
  }
});

describe("#748 the website widget, from a customer's page to the inbox", () => {
  it("texts a code, takes it back, and the message reaches the inbox", async () => {
    expect(customerOrigin).not.toBe(loonextOrigin);
    const page = await browser.newPage();
    await page.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit$/, (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile = { render: (element, options) => options.callback(${JSON.stringify(CAPTCHA_TOKEN)}) };`,
      }),
    );
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    await page.goto(customerOrigin);

    await page.locator("button.launch").click();
    await page.locator("#lx-name").fill("Pat");
    await page.locator("#lx-phone").fill("604 555 0149");
    await page.locator("#lx-msg").fill("Burst pipe in the basement");
    const textsBefore = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;
    const sentStart = page.waitForRequest((req) => req.method() === "POST" && req.url().endsWith("/widget/start"));
    await page.locator("button.send").click();
    await expect.poll(() => page.getByText("We texted you a code.").count(), { timeout: 20_000 }).toBe(1);

    const sent = h.telnyx.callsTo("POST", /\/v2\/messages$/).slice(textsBefore);
    expect(sent).toHaveLength(1);
    const text = sent[0].body as { to: string; from: string; text: string };
    expect(text.to).toBe(VISITOR_E164);
    expect(text.from).toBe(NUMBER_E164);
    const code = /(\d{6}) is your code/.exec(text.text)?.[1];
    expect(code).toBeDefined();
    expect((await sentStart).postDataJSON()).toMatchObject({ phone: "604 555 0149", website: "", turnstileToken: CAPTCHA_TOKEN });

    await page.locator("#lx-code").fill(code!);
    const sentVerify = page.waitForRequest((req) => req.method() === "POST" && req.url().endsWith("/widget/verify"));
    const emailsBefore = h.emails.length;
    await page.locator("button.send").click();
    await expect
      .poll(() => page.getByText("Sent. They will text you back on that number.").count(), {
        timeout: 20_000,
      })
      .toBe(1);
    expect(failures).toEqual([]);

    const { data: contacts } = await h.db
      .from("contacts")
      .select("id,name")
      .eq("company_id", COMPANY_ID)
      .eq("phone_e164", VISITOR_E164);
    expect(contacts).toHaveLength(1);
    expect(contacts?.[0]?.name).toBe("Pat");
    const { data: messages } = await h.db
      .from("messages")
      .select("body,direction")
      .eq("company_id", COMPANY_ID)
      .eq("direction", "inbound");
    expect(messages?.map((m) => m.body)).toContain("Burst pipe in the basement");
    const { data: days } = await h.db.from("inbound_notification_days")
      .select("email_limit,push_limit").eq("company_id", COMPANY_ID);
    expect(days).toEqual([{ email_limit: 100, push_limit: 2000 }]);
    expect(h.emails).toHaveLength(emailsBefore + 1);

    const repeated = await h.call("POST", "/widget/verify", { body: (await sentVerify).postDataJSON() });
    expect(repeated.status).toBe(403);
    expect(h.emails).toHaveLength(emailsBefore + 1);
    const { data: events } = await h.db.from("webhook_deliveries")
      .select("event_type,payload").eq("company_id", COMPANY_ID);
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: "message.received", payload: expect.objectContaining({
        data: expect.objectContaining({ body: "Burst pipe in the basement", source: "widget" }),
      }) }),
      expect.objectContaining({ event_type: "contact.created", payload: expect.objectContaining({
        data: expect.objectContaining({ name: "Pat" }),
      }) }),
    ]));
  }, 90_000);
});
