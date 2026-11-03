import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { standingBook } from "./numbers.ts";
import {
  MissingSecret,
  parseSupabaseStatus,
  publishState,
  readState,
  rigHome,
  rigSettings,
  robotLocalToken,
  SecretFiles,
  storeNameOf,
} from "./rig-home.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rig-home-"));
  dirs.push(dir);
  return dir;
}

describe("the rig's layout", () => {
  it("follows the rig CLI: $RIG_HOME with secrets, state and work beneath it", () => {
    const home = rigHome({ RIG_HOME: "/srv/rig" });
    expect(home.home).toMatch(/[\\/]srv[\\/]rig$/);
    expect(home.secrets).toBe(join(home.home, "secrets"));
    expect(home.state).toBe(join(home.home, "state"));
    expect(home.supabaseWorkdir).toBe(join(home.home, "work", "supabase"));
    expect(rigHome({}).home).toMatch(/loonext-rig$/);
    expect(rigHome({ RIG_HOME: "/srv/rig", RIG_SECRETS_DIR: "/run/creds" }).secrets).toMatch(/[\\/]run[\\/]creds$/);
  });

  it("reads rig.json's settings with the CLI's defaults", () => {
    const home = rigHome({ RIG_HOME: temp() });
    expect(rigSettings(home)).toEqual({
      appOrigin: "https://app.rig.internal",
      apiPort: 8787,
      systemd: true,
    });
    writeFileSync(home.settingsFile, JSON.stringify({ apiPort: 9000, systemd: false }));
    expect(rigSettings(home)).toMatchObject({ apiPort: 9000, systemd: false });
  });

  it("publishes state by rename and reads it back", () => {
    const home = rigHome({ RIG_HOME: temp() });
    publishState(home, "uplink.json", { connected: true, at: "2026-10-31T05:00:00.000Z" });
    expect(readState(home, "uplink.json")).toEqual({ connected: true, at: "2026-10-31T05:00:00.000Z" });
    expect(readState(home, "absent.json")).toBeUndefined();
  });

});

describe("supabase status, read by the rig CLI's own rule", () => {
  const status = (fields: Record<string, string>) => `Stopped services: []\n${JSON.stringify(fields)}`;
  const local = {
    API_URL: "http://127.0.0.1:54321",
    DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    SECRET_KEY: "sb_secret_local",
    PUBLISHABLE_KEY: "sb_publishable_local",
  };

  it("takes the local stack's URL and keys", () => {
    expect(parseSupabaseStatus(status(local))).toEqual({
      apiUrl: "http://127.0.0.1:54321",
      secretKey: "sb_secret_local",
      publishableKey: "sb_publishable_local",
    });
    expect(parseSupabaseStatus(status({ ...local, API_URL: "http://host.docker.internal:54321" })).apiUrl).toBe(
      "http://host.docker.internal:54321",
    );
  });

  it("refuses a hosted API or database, as the CLI does", () => {
    expect(() => parseSupabaseStatus(status({ ...local, API_URL: "https://example.supabase.co" }))).toThrow(/remote host/);
    expect(() =>
      parseSupabaseStatus(status({ ...local, DB_URL: "postgresql://postgres:x@db.example.supabase.co:5432/postgres" })),
    ).toThrow(/remote host/);
  });

  it("refuses a status without the keys the app probe signs in with", () => {
    expect(() => parseSupabaseStatus("not json")).toThrow(/lacks the URL or keys/);
    const withoutPublishable: Record<string, string> = { ...local };
    delete withoutPublishable.PUBLISHABLE_KEY;
    expect(() => parseSupabaseStatus(status(withoutPublishable))).toThrow(/publishable key/);
  });
});

describe("the secret store", () => {
  it("reads one trimmed file per secret, and names the file, never the value, when one is missing", () => {
    const dir = temp();
    writeFileSync(join(dir, "edge-origin"), "https://edge.example.workers.dev\n");
    const store = new SecretFiles(dir);
    expect(store.read("edge-origin")).toBe("https://edge.example.workers.dev");
    expect(() => store.read("guard-token-robot")).toThrow(MissingSecret);
    expect(() => store.read("guard-token-robot")).toThrow(/guard-token-robot is not in the store/);
    expect(() => store.read("../etc/passwd")).toThrow(/not a secret name/);
    expect(store.readOptional("absent")).toBeUndefined();
  });

  it("writes atomically with owner-only permissions where the platform has them", () => {
    const dir = join(temp(), "secrets");
    const store = new SecretFiles(dir);
    store.write("control-token-rig", "token-value");
    expect(readFileSync(join(dir, "control-token-rig"), "utf8")).toBe("token-value\n");
    if (process.platform !== "win32") expect(statSync(join(dir, "control-token-rig")).mode & 0o777).toBe(0o600);
  });

  it("makes robotd's loopback token once and keeps it", () => {
    const store = new SecretFiles(temp());
    const token = robotLocalToken(store);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(robotLocalToken(store)).toBe(token);
  });

  it("maps sealed-bundle names onto store files", () => {
    expect(storeNameOf("GUARD_TOKEN_ROBOT")).toBe("guard-token-robot");
    expect(storeNameOf("GUARD_TOKEN_RIG_API")).toBe("guard-token-rig-api");
    expect(storeNameOf("STANDING_NUMBERS_JSON")).toBe("standing-numbers.json");
    expect(storeNameOf("RIG_APP_KEY")).toBe("rig-app-key");
    expect(() => storeNameOf("lower")).toThrow(/bundle name/);
  });
});

describe("standingBook", () => {
  const entries = [
    { role: "ROBOT-1", e164: "+14165550101", telnyx_phone_number_id: null, messaging_profile_id: null },
    { role: "DEV-W1", e164: "+14165550111" },
  ];

  it("reads the store's standing-numbers.json shape", () => {
    const book = standingBook(entries, ["+14165550101", "+14165550111"]);
    expect(book.number("DEV-W1")).toBe("+14165550111");
    expect(book.role("+14165550101")).toBe("ROBOT-1");
  });

  it("refuses a number the guard's live listing does not hold, without naming it", () => {
    expect(() => standingBook(entries, ["+14165550101"])).toThrow("numbers: DEV-W1 is not in the guard's live listing");
    expect(() => standingBook({ "ROBOT-1": "+14165550101" })).toThrow(/a list/);
    expect(() => standingBook([...entries, entries[0]])).toThrow(/listed twice/);
  });
});

describe("a fresh home", () => {
  it("creates the state folder on first publish", () => {
    const root = temp();
    mkdirSync(join(root, "home"));
    const home = rigHome({ RIG_HOME: join(root, "home") });
    publishState(home, "api-exceptions.json", { at: "x", unexplained_24h: [] });
    expect(readState(home, "api-exceptions.json")).toEqual({ at: "x", unexplained_24h: [] });
  });
});
