/**
 * The browser lane in a real Chromium, with no app: a page joins two peer
 * connections on loopback, so the fake microphone's code goes through Opus
 * and back as a remote track, and the in-page judge and the robot's detector
 * must find it there. Run with `pnpm --filter @loonext/rig-lanes test:browser`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { numberBook, writeFakeMicWavs } from "@loonext/rig-robot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumArgs } from "./args.ts";
import { BrowserLane, fillCheckout } from "./lane.ts";

const LOOPBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>loopback</title>
<script>
window.startLoopback = async () => {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  mic.getTracks().forEach((t) => a.addTrack(t, mic));
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  return true;
};
</script>`;

/** The two controls the lane reads a call's state from: the ring dialog's Answer and the call bar's Hang up. */
const CALL_BAR_PAGE = `<!doctype html><meta charset="utf-8"><title>call bar</title>
<div role="dialog"><button id="answer">Answer</button></div>
<div id="bar" style="display: none"><button>Hang up</button></div>
<script>
window.answerThenEnd = (talkMs) => {
  document.getElementById("answer").remove();
  document.getElementById("bar").style.display = "block";
  setTimeout(() => { document.getElementById("bar").style.display = "none"; }, talkMs);
};
</script>`;

/**
 * The number step as the wizard renders it (app/onboarding/number/page.tsx and
 * components/numbers/number-picker.tsx): Radix radios named by their labels,
 * the area-code search and its suggestions, then the picker's inventory.
 * `?inventory=` picks masked, revealed, a first load that fails, or none in 416.
 */
const NUMBER_STEP_PAGE = `<!doctype html><meta charset="utf-8"><title>number step</title>
<label><button type="button" role="radio" aria-checked="true" id="us"></button>United States</label>
<label><button type="button" role="radio" aria-checked="false" id="ca"></button>Canada</label>
<div id="search"><label for="np-area">Area code (optional)</label><input id="np-area"></div>
<button type="button" id="change" hidden>Change area code</button>
<ul id="suggestions"></ul>
<div id="picker"></div>
<label><button type="button" role="radio" aria-checked="true" id="us-yes"></button>Yes, I text US customers too</label>
<label><button type="button" role="radio" aria-checked="false" id="us-no"></button>No, Canadian customers only</label>
<button type="button" id="continue">Continue</button>
<script>
const inventory = new URLSearchParams(location.search).get("inventory");
let loads = 0;
window.picked = null;
const picker = document.getElementById("picker");
const check = (id) => document.getElementById(id).setAttribute("aria-checked", "true");
document.getElementById("ca").onclick = () => check("ca");
document.getElementById("us-no").onclick = () => check("us-no");
const search = document.getElementById("search");
const change = document.getElementById("change");
change.onclick = () => { search.hidden = false; change.hidden = true; picker.innerHTML = ""; };
document.getElementById("np-area").oninput = (event) => {
  const code = event.target.value;
  if (!/^[0-9]{3}$/.test(code)) return;
  document.getElementById("suggestions").innerHTML = '<li><button type="button" id="npa">(' + code + ') · Ontario<span>Ontario</span></button></li>';
  document.getElementById("npa").onclick = () => {
    document.getElementById("suggestions").innerHTML = "";
    search.hidden = true;
    change.hidden = false;
    event.target.value = "";
    load(code);
  };
};
function load(code) {
  loads++;
  if (inventory === "dry" && code === "416") {
    picker.innerHTML = '<p>No numbers in area code 416 right now. Turn on nearby numbers, or try a different area code.</p>';
    return;
  }
  if (inventory === "flaky" && loads === 1) {
    picker.innerHTML = '<p>Couldn&#39;t load numbers. Try Refresh in a moment.</p><button type="button" id="refresh">Refresh</button>';
    document.getElementById("refresh").onclick = () => setTimeout(() => load(code), 200);
    return;
  }
  if (inventory === "revealed") {
    picker.innerHTML = '<ul><li><button type="button" role="radio" aria-checked="false" data-n="+14165550123">(416) 555-0123</button></li><li><button type="button" role="radio" aria-checked="false" data-n="+14165550124">(416) 555-0124</button></li></ul>';
    for (const row of picker.querySelectorAll("[data-n]")) row.onclick = () => { window.picked = row.dataset.n; };
    return;
  }
  picker.innerHTML = '<button type="button" role="radio" aria-checked="false" id="masked"><span style="display:block">Get a number in area code ' + code + '</span><span style="display:block">We assign the exact number when your account is set up.</span></button>';
  document.getElementById("masked").onclick = () => { window.picked = code; };
}
document.getElementById("continue").onclick = () => {
  if (window.picked && document.getElementById("us-no").getAttribute("aria-checked") === "true") location.href = "/onboarding/plan?picked=" + encodeURIComponent(window.picked);
};
</script>`;

/** Hosted Checkout's fields, by the element names Stripe gives them, behind its card accordion. */
const CHECKOUT_PAGE = `<!doctype html><meta charset="utf-8"><title>checkout</title>
<form onsubmit="event.preventDefault(); window.submitted = Object.fromEntries(new FormData(this));">
<input name="email">
<button type="button" data-testid="card-accordion-item-button" onclick="document.getElementById('card').hidden = false">Card</button>
<div id="card" hidden>
<input name="cardNumber"><input name="cardExpiry"><input name="cardCvc"><input name="billingName">
<select name="billingCountry"><option value="US">United States</option><option value="CA">Canada</option></select>
<input name="billingPostalCode">
</div>
<button type="submit">Subscribe</button>
</form>`;

let server: Server;
let origin: string;
const PAGES: Record<string, string> = { "/call-bar": CALL_BAR_PAGE, "/onboarding/number": NUMBER_STEP_PAGE, "/pay": CHECKOUT_PAGE };
const dir = mkdtempSync(join(tmpdir(), "rig-lane-browser-"));

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://lane.test").pathname;
    const page = PAGES[path] ?? (path.startsWith("/onboarding/") ? "<!doctype html><title>step</title>" : LOOPBACK_PAGE);
    response.writeHead(200, { "content-type": "text/html" }).end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  writeFakeMicWavs(join(dir, "mic"));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe("the browser lane in Chromium", () => {
  it("hears its member's code after Opus, through the in-page judge", async () => {
    const lane = new BrowserLane({
      appOrigin: origin,
      profilesDir: join(dir, "profiles"),
      fakeMicDir: join(dir, "mic"),
      numbers: numberBook({}),
    });
    try {
      const page = await lane.open("qa-w-owner", "qa-w-owner", "/");
      await page.page.evaluate(() => (window as unknown as { startLoopback(): Promise<boolean> }).startLoopback());
      await page.mark("answered");
      await page.page.waitForTimeout(13_000);
      const hearing = await page.hear();
      expect(hearing.capture.remoteStreams).toBe(1);
      // The page hears its own code back, which the judge names as echo, never as the answerer.
      expect(hearing.detection.answered).toBeNull();
      expect(hearing.detection.echo).toMatchObject({ surface: "qa-w-owner" });
      expect(hearing.detection.echo!.cycles).toBeGreaterThanOrEqual(3);
      // getStats sees the packets but, with the stream on a muted element, reports no inbound energy.
      const inbound = hearing.capture.stats.filter((s) => s.kind === "inbound");
      expect(inbound.at(-1)?.totalSamplesReceived).toBeGreaterThan(0);
      expect(hearing.capture.stats.some((s) => s.kind === "source" && (s.totalAudioEnergy ?? 0) > 0)).toBe(true);
      expect(hearing.concealedRatio).toBeDefined();
    } finally {
      await lane.closeAll();
    }
  });

  it("tells a page still ringing or in a call from one that holds no call", async () => {
    const lane = new BrowserLane({
      appOrigin: origin,
      profilesDir: join(dir, "profiles"),
      fakeMicDir: join(dir, "mic"),
      numbers: numberBook({}),
    });
    try {
      const page = await lane.open("qa-a-dispatcher", "qa-a-dispatcher", "/call-bar");
      expect(await page.waitForCallCleared(500)).toBeUndefined();
      const answered = Date.now();
      await page.page.evaluate(() => (window as unknown as { answerThenEnd(ms: number): void }).answerThenEnd(3_000));
      // The ring dialog has gone, but the call bar still shows.
      expect(await page.waitForCallCleared(500)).toBeUndefined();
      expect(await page.waitForCallCleared(10_000)).toBeDefined();
      expect(Date.now() - answered).toBeGreaterThanOrEqual(3_000);
    } finally {
      await lane.closeAll();
    }
  });

  it("makes blocked host patterns fail to resolve, wildcards included", async () => {
    const port = (server.address() as AddressInfo).port;
    const launch = (blocked: string[]) =>
      chromium.launch({ args: chromiumArgs({ fakeMicWav: join(dir, "mic", "robot.wav"), blocked }) });
    // Chromium resolves localhost and every *.localhost to loopback by itself,
    // so these names reach the test server unless the rules stop them.
    const open = await launch(["unrelated.invalid"]);
    const blocked = await launch(["localhost", "*.localhost"]);
    try {
      const control = await open.newPage();
      expect((await control.goto(`http://app.localhost:${port}/`))?.status()).toBe(200);
      // A fresh page per navigation: a failed one leaves an error page loading behind it.
      for (const host of ["localhost", "app.localhost"]) {
        const page = await blocked.newPage();
        await expect(page.goto(`http://${host}:${port}/`)).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
        await page.close();
      }
      const direct = await blocked.newPage();
      expect((await direct.goto(`http://127.0.0.1:${port}/`))?.status()).toBe(200);
    } finally {
      await open.close();
      await blocked.close();
    }
  });

  it("picks Canada's masked choice or a revealed number, refreshing a failed load and moving past a dry area code, then continues", async () => {
    const lane = new BrowserLane({ appOrigin: origin, profilesDir: join(dir, "profiles"), fakeMicDir: join(dir, "mic"), numbers: numberBook({}) });
    try {
      for (const [inventory, expected, picked] of [
        ["masked", { inventory: "masked", refreshes: 0, areaCode: "416" }, "416"],
        ["revealed", { inventory: "revealed", refreshes: 0, areaCode: "416" }, "+14165550123"],
        ["flaky", { inventory: "masked", refreshes: 1, areaCode: "416" }, "416"],
        ["dry", { inventory: "masked", refreshes: 0, areaCode: "647" }, "647"],
      ] as const) {
        const page = await lane.openPublic(`/onboarding/number?inventory=${inventory}`);
        expect(await page.chooseCanadianNumber({ areaCodes: ["416", "647"] }), inventory).toEqual({ ...expected, continued: true });
        expect(new URL(page.page.url()).searchParams.get("picked"), inventory).toBe(picked);
        await page.close();
      }
    } finally {
      await lane.closeAll();
    }
  });

  it("fills Checkout behind its card accordion with the email, the card and a Canadian postal code", async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${origin}/pay`);
      expect(await fillCheckout(page, { card: "4242424242424242", email: "owner@example.invalid", postalCode: "M5V 3L9" })).toEqual({ challenged: false, submitted: true });
      expect(await page.evaluate(() => (window as unknown as { submitted: Record<string, string> }).submitted)).toEqual({
        email: "owner@example.invalid",
        cardNumber: "4242424242424242",
        cardExpiry: "12 / 34",
        cardCvc: "123",
        billingName: "Rig Owner",
        billingCountry: "CA",
        billingPostalCode: "M5V 3L9",
      });
    } finally {
      await browser.close();
    }
  });
});
