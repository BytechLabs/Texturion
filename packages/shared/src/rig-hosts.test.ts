import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These pin what `scripts/check-rig-hosts.mjs` reads as a host in each of the
 * rig's configs, and which hosts count as the rig's own.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Findings = { judged: number; refused: number; problems: string[] };
const guard = (await import(join(REPO, "scripts", "check-rig-hosts.mjs"))) as {
  isRigHost: (host: string) => boolean;
  isLoopback: (host: string) => boolean;
  hostsInText: (text: string) => string[];
  hostsInValue: (value: unknown) => { at: string; host: string }[];
  hostsInString: (text: string) => string[];
  tomlStrings: (line: string) => string[];
  tomlFindings: (where: string, text: string) => Findings;
  dnsmasqRefusal: (line: string) => string[] | null;
  boxFindings: (path: string, text: string) => Findings;
  templateFindings: (path: string, text: string) => Findings;
  jsonFindings: (path: string, value: unknown) => Findings;
  wranglerFindings: (path: string, config: Record<string, unknown>) => Findings;
  derivedFindings: (source: string, derived: Record<string, unknown>) => Findings;
};

const supabase = (await import(join(REPO, "tools", "rig", "src", "supabase-config.mjs"))) as {
  deriveSupabaseConfig: (text: string, options: Record<string, unknown>) => string;
};

describe("the rig's own hosts", () => {
  it.each([
    "api.rig.internal",
    "rig.internal",
    "127.0.0.1",
    "127.3.2.1",
    "localhost",
    "::1",
    "[::1]",
    "192.168.70.10",
    "192.168.70.1",
    "loonext-rig-edge.acct.workers.dev",
  ])("passes %s", (host) => {
    expect(guard.isRigHost(host)).toBe(true);
  });

  it.each([
    "api.loonext.com",
    "abc.supabase.co",
    "another-worker.acct.workers.dev",
    "loonext-rig-edge.workers.dev.example.com",
    "rig.internal.example.com",
    "evilrig.internal",
    "10.0.0.1",
    "0.0.0.0",
    // The retired access point's subnet.
    "10.77.0.1",
    "192.168.70.11",
    "192.168.70.100",
    "192.168.70.2",
    "192.168.7.10",
  ])("fails %s", (host) => {
    expect(guard.isRigHost(host)).toBe(false);
  });

  it("calls only loopback loopback", () => {
    expect(guard.isLoopback("127.0.0.1")).toBe(true);
    expect(guard.isLoopback("192.168.70.10")).toBe(false);
  });
});

describe("what it reads as a host", () => {
  it("reads URL hosts, IP or name, with or without a port", () => {
    expect(guard.hostsInText("--forward-to https://api.rig.internal/webhooks/stripe")).toEqual(["api.rig.internal"]);
    expect(guard.hostsInText("TELEMETRY=http://127.0.0.1:8790/1")).toEqual(["127.0.0.1"]);
  });

  it("reads a bare name under a domain, and an address", () => {
    expect(guard.hostsInText("reverse_proxy api.loonext.com:443")).toEqual(["api.loonext.com"]);
    expect(guard.hostsInText("bind 127.0.0.1 192.168.70.10")).toEqual(["127.0.0.1", "192.168.70.10"]);
  });

  it("leaves file names, mailboxes and netmasks alone", () => {
    expect(guard.hostsInText("cert /etc/loonext-rig/ca/root.crt")).toEqual([]);
    expect(guard.hostsInText("Requires=loonext-rig-stack.service rig.mjs")).toEqual([]);
    expect(guard.hostsInText("ROBOT=delivered@resend.dev")).toEqual([]);
    expect(guard.hostsInText("dhcp-range=192.168.70.20,192.168.70.50,255.255.255.0,12h")).toEqual(["192.168.70.20", "192.168.70.50"]);
  });

  it("reads a URL's host past its userinfo and port", () => {
    expect(guard.hostsInText("https://user:pass@api.loonext.com:443/x")).toEqual(["api.loonext.com"]);
    expect(guard.hostsInText("https://key@o123.ingest.us.vendor.test/45")).toEqual(["o123.ingest.us.vendor.test"]);
    expect(guard.hostsInText("file:///etc/loonext-rig/rig.json")).toEqual([]);
  });

  it.each([
    ["api.loonext.com:443", "api.loonext.com"],
    ["api.loonext.com/*", "api.loonext.com"],
    ["*.loonext.com/*", "loonext.com"],
    ["//api.loonext.com/x", "api.loonext.com"],
    ["api.loonext.com.", "api.loonext.com"],
    ["smtp.resend.com:465", "smtp.resend.com"],
    ["stripe listen --forward-to https://api.loonext.com/webhooks/stripe", "api.loonext.com"],
    ["[::1]:8787", "[::1]"],
  ])("reads the host a value %s names", (value, host) => {
    expect(guard.hostsInString(value)).toEqual([host]);
  });

  it.each([["0.0.0.0/0"], ["::/0"], ["src/index.ts"], ["next.config.ts"], ["1.2.3"], ["notifications@loonext.com"]])(
    "reads no host in %s",
    (value) => {
      expect(guard.hostsInString(value)).toEqual([]);
    },
  );

  it("reads JSON values that are a URL or a host, not prose naming one", () => {
    expect(
      guard.hostsInValue({
        origin: "https://app.rig.internal",
        hosts: ["db.rig.internal"],
        ip: "127.0.0.1:8787",
        note: "The guard sends only to Resend's test addresses at resend.dev.",
        main: "src/index.ts",
      }),
    ).toEqual([
      { at: "origin", host: "app.rig.internal" },
      { at: "hosts[0]", host: "db.rig.internal" },
      { at: "ip", host: "127.0.0.1" },
    ]);
  });
});

describe("the host contract", () => {
  const contract = { vm: { address: "192.168.70.10", host: "192.168.70.1", gateway: "192.168.70.2", user: "rig" } };

  it("passes the VM's address, the workstation's and the gateway named as the gateway", () => {
    expect(guard.jsonFindings("tools/rig/host/contract.json", contract)).toEqual({ judged: 3, refused: 0, problems: [] });
  });

  it("fails the gateway anywhere else, and any other VMnet8 address", () => {
    expect(guard.jsonFindings("tools/rig/host/contract.json", { vm: { dns: "192.168.70.2" } }).problems).toEqual([
      "tools/rig/host/contract.json vm.dns  names 192.168.70.2, which is not the rig's",
    ]);
    expect(guard.jsonFindings("tools/rig/other.json", { vm: { gateway: "192.168.70.2" } }).problems).toHaveLength(1);
    expect(guard.jsonFindings("tools/rig/host/contract.json", { vm: { ...contract.vm, address: "192.168.70.11" } }).problems).toEqual([
      "tools/rig/host/contract.json vm.address  names 192.168.70.11, which is not the rig's",
    ]);
  });
});

describe("the box's configs", () => {
  it("reads a dnsmasq line that resolves a name to nothing as a refusal", () => {
    expect(guard.dnsmasqRefusal("local=/loonext.com/")).toEqual(["loonext.com"]);
    expect(guard.dnsmasqRefusal("local=/supabase.co/pooler.supabase.com/")).toEqual(["supabase.co", "pooler.supabase.com"]);
    expect(guard.dnsmasqRefusal("address=/loonext.com/0.0.0.0")).toEqual(["loonext.com"]);
    expect(guard.dnsmasqRefusal("address=/rig.internal/127.0.0.1")).toBeNull();
  });

  it("passes refusals and the rig's own answers", () => {
    const text = [
      "# loonext.com resolves to nothing",
      "listen-address=127.0.0.1",
      "address=/rig.internal/127.0.0.1",
      "local=/loonext.com/",
      "local=/api.telnyx.com/",
    ].join("\n");
    expect(guard.boxFindings("tools/rig/box/dnsmasq/host.conf", text)).toEqual({ judged: 3, refused: 2, problems: [] });
  });

  it("fails a forward of a production name, and a Caddy site that proxies to production", () => {
    expect(guard.boxFindings("tools/rig/box/dnsmasq/host.conf", "server=/supabase.co/1.1.1.1").problems).toEqual([
      "tools/rig/box/dnsmasq/host.conf:1  names supabase.co, which is not the rig's",
      "tools/rig/box/dnsmasq/host.conf:1  names 1.1.1.1, which is not the rig's",
    ]);
    const caddy = "api.rig.internal {\n\treverse_proxy api.loonext.com:443\n}";
    expect(guard.boxFindings("tools/rig/box/caddy/Caddyfile", caddy).problems).toEqual([
      "tools/rig/box/caddy/Caddyfile:2  names api.loonext.com, which is not the rig's",
    ]);
  });

  it("fails a Caddy bind or a DNS answer on the retired access point", () => {
    expect(guard.boxFindings("tools/rig/box/caddy/Caddyfile", "\tbind 127.0.0.1 10.77.0.1").problems).toEqual([
      "tools/rig/box/caddy/Caddyfile:1  names 10.77.0.1, which is not the rig's",
    ]);
    expect(guard.boxFindings("tools/rig/box/dnsmasq/emulators.conf", "address=/rig.internal/192.168.70.11").problems).toEqual([
      "tools/rig/box/dnsmasq/emulators.conf:1  names 192.168.70.11, which is not the rig's",
    ]);
  });

  it("reads a firewall's address blocks as ranges, and its hosts as hosts", () => {
    const nft = [
      "define host = 192.168.70.1",
      "define gateway = 192.168.70.2",
      "elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10 }",
      "ip saddr $host tcp dport { 22, 53, 443 } accept",
    ].join("\n");
    expect(guard.boxFindings("tools/rig/box/nftables/loonext-rig.nft", nft)).toEqual({ judged: 2, refused: 0, problems: [] });
    expect(guard.boxFindings("tools/rig/box/nftables/loonext-rig.nft", "ip daddr 10.0.0.5 accept").problems).toEqual([
      "tools/rig/box/nftables/loonext-rig.nft:1  names 10.0.0.5, which is not the rig's",
    ]);
    expect(guard.boxFindings("tools/rig/box/caddy/Caddyfile", "bind 10.0.0.0/8").problems).toHaveLength(1);
  });

  it("passes the NAT gateway only where the firewall defines it as the gateway", () => {
    expect(guard.boxFindings("tools/rig/box/nftables/loonext-rig.nft", "define gateway = 192.168.70.3").problems).toEqual([
      "tools/rig/box/nftables/loonext-rig.nft:1  defines the gateway as 192.168.70.3, not VMnet8's 192.168.70.2",
    ]);
    expect(guard.boxFindings("tools/rig/box/nftables/loonext-rig.nft", "define upstream = 192.168.70.2").problems).toHaveLength(1);
    expect(guard.boxFindings("tools/rig/box/caddy/Caddyfile", "reverse_proxy 192.168.70.2:443").problems).toHaveLength(1);
  });

  it("does not read a dnsmasq-shaped line outside dnsmasq as a refusal", () => {
    expect(guard.boxFindings("tools/rig/box/caddy/Caddyfile", "local=/loonext.com/").problems).toHaveLength(1);
  });
});

describe("the settings template", () => {
  it("passes placeholders and fails a literal production host", () => {
    const text = "# APP_ORIGIN is https://app.loonext.com in production\nAPP_ORIGIN={{rig.appOrigin}}\nAPI_ORIGIN={{edge}}";
    expect(guard.templateFindings("t", text)).toEqual({ judged: 0, refused: 0, problems: [] });
    expect(guard.templateFindings("t", "APP_ORIGIN=https://app.loonext.com").problems).toEqual([
      "t:1  names app.loonext.com, which is not the rig's",
    ]);
  });

  it("judges the literal part of a host built around a placeholder", () => {
    expect(guard.templateFindings("t", "TELEMETRY_URL=https://{{secret:telemetry-key}}@o123.ingest.us.vendor.test/45").problems).toEqual([
      "t:1  names o123.ingest.us.vendor.test, which is not the rig's",
    ]);
    expect(guard.templateFindings("t", "SUPABASE_URL=https://{{secret:project-ref}}.supabase.co").problems).toEqual([
      "t:1  names {{...}}.supabase.co, which is not the rig's",
    ]);
    expect(guard.templateFindings("t", "WEB=https://{{rig.name}}.rig.internal/x").problems).toEqual([]);
  });

  it("does not judge a host that is only placeholders", () => {
    const text = "A=https://{{a}}{{b}}/x\nB={{edge}}\nC={{rig.supabaseUrl}}/auth/v1/.well-known/jwks.json";
    expect(guard.templateFindings("t", text)).toEqual({ judged: 0, refused: 0, problems: [] });
  });
});

describe("the Supabase config the deploy CLI derives", () => {
  const toml = [
    "[auth]",
    'site_url = "https://app.loonext.com"',
    'additional_redirect_urls = ["https://app.loonext.com/**"]',
    "",
    "[auth.email]",
    "enable_confirmations = false",
    "",
    "[auth.email.smtp]",
    "enabled = false",
    "",
    "[auth.mfa.totp]",
    "enroll_enabled = false",
    "verify_enabled = false",
  ].join("\n");
  const derive = (text: string) =>
    supabase.deriveSupabaseConfig(text, { supabaseUrl: "https://db.rig.internal", appOrigin: "https://app.rig.internal", totp: true });

  it("reads string values and leaves comments alone", () => {
    expect(guard.tomlStrings(`urls = ["https://a.rig.internal", 'b # c'] # "https://x.loonext.com"`)).toEqual([
      "https://a.rig.internal",
      "b # c",
    ]);
    expect(guard.tomlStrings('# site_url = "https://app.loonext.com"')).toEqual([]);
  });

  it("passes production's auth URLs once the derivation has replaced them", () => {
    const findings = guard.tomlFindings("s", derive(toml));
    expect(findings.problems).toEqual([]);
    expect(findings.judged).toBeGreaterThan(0);
  });

  it("fails a host the derivation keeps verbatim", () => {
    const smtp = toml.replace("enabled = false", 'enabled = true\nhost = "smtp.resend.com"');
    expect(guard.tomlFindings("s", derive(smtp)).problems).toEqual([
      expect.stringMatching(/^s:\d+ {2}names smtp\.resend\.com, which is not the rig's$/),
    ]);
  });
});

describe("the rig's Worker configs", () => {
  const guardConfig = { name: "loonext-telnyx-guard", workers_dev: false, preview_urls: false };

  it("passes the guard closed to the internet and the edge on workers.dev", () => {
    expect(guard.wranglerFindings("g", guardConfig).problems).toEqual([]);
    expect(guard.wranglerFindings("e", { name: "loonext-rig-edge", workers_dev: true, routes: [] }).problems).toEqual([]);
  });

  it("fails a route, in the config or in an environment", () => {
    expect(guard.wranglerFindings("e", { name: "loonext-rig-edge", routes: [{ pattern: "x" }] }).problems).toHaveLength(1);
    expect(guard.wranglerFindings("e", { name: "loonext-rig-edge", route: "x" }).problems).toHaveLength(1);
    expect(guard.wranglerFindings("e", { name: "loonext-rig-edge", env: { a: { routes: ["x"] } } }).problems).toEqual([
      "e  sets env.a.routes; the rig's Workers have no routes",
    ]);
  });

  it("fails the guard on workers.dev, or leaving either default on", () => {
    expect(guard.wranglerFindings("g", { ...guardConfig, workers_dev: true }).problems).toHaveLength(1);
    expect(guard.wranglerFindings("g", { name: "loonext-telnyx-guard" }).problems).toHaveLength(2);
  });
});

describe("the configs the deploy CLI derives", () => {
  const derived = (over: Record<string, unknown> = {}) => {
    const base = { name: "loonext-api", vars: {}, dev: { ip: "127.0.0.1", port: 8787 }, ...over };
    return { ...base, env: { rig: { ...base, dev: undefined } } };
  };

  it("passes a local config", () => {
    expect(guard.derivedFindings("apps/api/wrangler.jsonc", derived()).problems).toEqual([]);
  });

  it("fails production wiring that survived, and a production var", () => {
    const problems = guard.derivedFindings("s", derived({ routes: [], vars: { ORIGIN: "https://app.loonext.com" } })).problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        "s (derived wrangler.rig.jsonc)  keeps routes",
        "s (derived wrangler.rig.jsonc)  keeps env.rig.routes",
        "s (derived wrangler.rig.jsonc) vars.ORIGIN  names app.loonext.com, which is not the rig's",
      ]),
    );
  });

  it("fails wrangler dev listening anywhere but loopback", () => {
    expect(guard.derivedFindings("s", derived({ dev: { ip: "192.168.70.10" } })).problems).toEqual([
      's (derived wrangler.rig.jsonc)  serves on "192.168.70.10"; wrangler dev must listen on loopback',
    ]);
  });
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-rig-hosts\.mjs\s*$/m);
});
