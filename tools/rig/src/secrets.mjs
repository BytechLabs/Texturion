/**
 * The rig's secret store: one file per secret in a folder only the rig user
 * can read, the shape systemd's LoadCredential= and rigd's secret delivery
 * (/ctl/secrets) both write. A value never appears in an error, a log line or
 * the repository; errors name the file.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = /^[a-z0-9][a-z0-9.-]*$/;

export class MissingSecret extends Error {}

export function secretStore(dir) {
  const pathOf = (name) => {
    if (!NAME.test(name)) throw new Error(`rig secrets: "${name}" is not a secret name`);
    return join(dir, name);
  };

  const store = {
    dir,
    has: (name) => existsSync(pathOf(name)),
    read(name) {
      const path = pathOf(name);
      if (!existsSync(path)) {
        throw new MissingSecret(`rig secrets: ${name} is not in the store (${dir})`);
      }
      return readFileSync(path, "utf8").trim();
    },
    readOptional: (name) => (store.has(name) ? store.read(name) : undefined),
    readJson(name) {
      try {
        return JSON.parse(store.read(name));
      } catch (error) {
        if (error instanceof MissingSecret) throw error;
        throw new Error(`rig secrets: ${name} is not valid JSON`);
      }
    },
    write(name, value) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = pathOf(name);
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
      });
      renameSync(temp, path);
      chmodSync(path, 0o600);
    },
    /** The stored value, or a generated one stored for every later call. */
    ensureJson(name, generate) {
      if (store.has(name)) return store.readJson(name);
      const value = generate();
      store.write(name, value);
      return value;
    },
  };
  return store;
}
