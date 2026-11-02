#!/usr/bin/env node
/**
 * rigd's commands, run under Node by type stripping on the rig. Nothing here
 * runs on a timer: `run` is how a scenario starts, when someone asks.
 *
 *   node tools/rig/rigd/src/cli.ts daemon
 *   node tools/rig/rigd/src/cli.ts run <scenario>[-<run>] [--run-id <id>]
 *   node tools/rig/rigd/src/cli.ts units --install | --out <dir> [--node <path>]
 *   node tools/rig/rigd/src/cli.ts secrets
 *   node tools/rig/rigd/src/cli.ts budget
 *   node tools/rig/rigd/src/cli.ts verdicts [--unresolved]
 *   node tools/rig/rigd/src/cli.ts calibrate --surface <surface> --wav <file> [--own <surface>]
 *
 * Every command reads $RIG_HOME (default /var/lib/loonext-rig) the way the
 * `rig` CLI lays it out.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyzeFrames, calibrate, decodeWav, isSurface, loadMargins, saveMargins, SURFACES, SURFACE_HZ } from "@loonext/rig-robot";
import { clockHourStart, utcDayStart } from "./budget.ts";
import { loadConfig } from "./config.ts";
import { deliverSecrets } from "./secrets.ts";
import { startDaemon } from "./daemon.ts";
import { installUnits, userUnitDir } from "./install.ts";
import { loadRegistry, parseInstance } from "./registry.ts";
import { runScenario } from "./runner.ts";
import { NOT_RUNNABLE_YET } from "./scenarios/index.ts";
import { buildUnits } from "./units.ts";
import { VerdictStore } from "./verdicts.ts";
import { buildRig, marginsFileOf, rigdDir } from "./wiring.ts";

const CLI = fileURLToPath(import.meta.url);

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      unresolved: { type: "boolean" },
      install: { type: "boolean" },
      "run-id": { type: "string" },
      out: { type: "string" },
      node: { type: "string" },
      surface: { type: "string" },
      own: { type: "string" },
      wav: { type: "string" },
    },
  });
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  switch (command) {
    case "daemon": {
      const daemon = startDaemon(loadConfig());
      const stop = () => {
        daemon.stop();
        process.exit(0);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      return new Promise<number>(() => undefined);
    }
    case "run": {
      if (!positionals[0]) throw new Error("run <scenario>[-<run>]");
      const { id, slot } = parseInstance(positionals[0]);
      if (NOT_RUNNABLE_YET[id]) throw new Error(`${id} cannot be run yet: ${NOT_RUNNABLE_YET[id]}`);
      const rig = buildRig(loadConfig());
      // A schema-change deploy stops a run's unit; its undos land before the migration does.
      process.once("SIGTERM", () => {
        void rig.leases
          .releaseOwn()
          .catch((error: unknown) => console.error(`run: undoing on stop failed: ${error instanceof Error ? error.message : "error"}`))
          .finally(() => process.exit(143));
      });
      print(await runScenario(rig.runnerDeps(), id, { slot, runId: values["run-id"] }));
      return 0;
    }
    case "units": {
      if (!values.out && !values.install) throw new Error("units --install | --out <dir>");
      const config = loadConfig();
      const units = buildUnits({ node: values.node ?? process.execPath, cli: CLI, home: config.home.home });
      if (values.install) {
        if (!config.systemd) throw new Error("units --install: rig.json has systemd off");
        print(installUnits(units, { unitDir: userUnitDir() }));
        return 0;
      }
      mkdirSync(values.out!, { recursive: true });
      for (const unit of units) writeFileSync(join(values.out!, unit.name), unit.content);
      print({ units: units.map((unit) => unit.name) });
      return 0;
    }
    case "budget": {
      const config = loadConfig();
      const registry = loadRegistry(config.registryPath);
      const caps = config.capsOverride ?? registry.caps;
      const store = new VerdictStore(join(rigdDir(config), "verdicts"));
      const now = Date.now();
      const spentIn = (from: number, to: number) => store.dialsBetween(from, to);
      print({
        caps: { daily: caps.daily, hourly: caps.hourly },
        window: registry.caps.window,
        spent: {
          today: spentIn(utcDayStart(now), utcDayStart(now) + 86_400_000),
          this_hour: spentIn(clockHourStart(now), clockHourStart(now) + 3_600_000),
        },
      });
      return 0;
    }
    case "verdicts": {
      const store = new VerdictStore(join(rigdDir(loadConfig()), "verdicts"));
      print(values.unresolved ? store.unresolved() : store.all().slice(-50));
      return 0;
    }
    case "calibrate": {
      const { surface, own, wav } = values;
      if (!isSurface(surface) || !wav || (own !== undefined && !isSurface(own))) {
        throw new Error(`calibrate --surface <${SURFACES.join("|")}> --wav <file> [--own <surface>]`);
      }
      const pcm = decodeWav(readFileSync(wav));
      const table = analyzeFrames(pcm.channels[0]!, pcm.sampleRate, SURFACES.map((s) => SURFACE_HZ[s]));
      const result = calibrate(table, { surface, own: own as typeof surface | undefined });
      const file = marginsFileOf(loadConfig());
      print({ result, margins: saveMargins(file, loadMargins(file), [result]) });
      return result.ok ? 0 : 1;
    }
    case "secrets": {
      const config = loadConfig();
      print(await deliverSecrets({ edgeOrigin: config.edgeOrigin, store: config.store }));
      return 0;
    }
    default:
      console.error("usage: cli.ts daemon | run <scenario> [--run-id <id>] | units --install | --out <dir> | budget | verdicts | secrets | calibrate");
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === CLI) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
