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
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The line Settings hands an owner to paste, built by the web app's own code.
import { widgetSnippet } from "../../web/src/lib/marketing/widget-snippet";
import { deleteCompaniesSql } from "./company-cleanup";
import { startHarness, type Harness } from "./harness";

const OWNER_ID = "d31c0748-0001-4001-8001-000000000001";
const COMPANY_ID = "d31c0748-0002-4002-8002-000000000002";
const NUMBER_ID = "d31c0748-0003-4003-8003-000000000003";
const NUMBER_E164 = "+16045550148";
const VISITOR_E164 = "+16045550149";

const WIDGET_JS = readFileSync(join(import.meta.dirname, "..", "..", "web", "public", "widget.js"));

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
  `);
  const widgetKey = h.sql(`select widget_key from public.companies where id = '${COMPANY_ID}';`).trim();

  // Loonext's side: the script the web app serves, and the Worker behind it.
  loonext = createServer(async (req, res) => {
    if (req.url === "/widget.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(WIDGET_JS);
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
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(String(error)));
    await page.goto(customerOrigin);

    await page.locator("button.launch").click();
    await page.locator("#lx-name").fill("Pat");
    await page.locator("#lx-phone").fill("604 555 0149");
    await page.locator("#lx-msg").fill("Burst pipe in the basement");
    const textsBefore = h.telnyx.callsTo("POST", /\/v2\/messages$/).length;
    await page.locator("button.send").click();
    await expect.poll(() => page.getByText("We texted you a code.").count(), { timeout: 20_000 }).toBe(1);

    const sent = h.telnyx.callsTo("POST", /\/v2\/messages$/).slice(textsBefore);
    expect(sent).toHaveLength(1);
    const text = sent[0]!.body as { to: string; from: string; text: string };
    expect(text.to).toBe(VISITOR_E164);
    expect(text.from).toBe(NUMBER_E164);
    const code = /(\d{6}) is your code/.exec(text.text)?.[1];
    expect(code).toBeDefined();

    await page.locator("#lx-code").fill(code!);
    await page.locator("button.send").click();
    await expect
      .poll(() => page.getByText("Sent. They will text you back on that number.").count(), {
        timeout: 20_000,
      })
      .toBe(1);
    expect(failures).toEqual([]);

    const { data: contacts } = await h.db
      .from("contacts")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .eq("phone_e164", VISITOR_E164);
    expect(contacts).toHaveLength(1);
    const { data: messages } = await h.db
      .from("messages")
      .select("body,direction")
      .eq("company_id", COMPANY_ID)
      .eq("direction", "inbound");
    expect(messages?.map((m) => m.body)).toContain("Pat: Burst pipe in the basement");
  }, 90_000);
});
