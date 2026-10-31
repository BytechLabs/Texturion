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
import { BrowserLane } from "./lane.ts";

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

let server: Server;
let origin: string;
const dir = mkdtempSync(join(tmpdir(), "rig-lane-browser-"));

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(LOOPBACK_PAGE);
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
});
