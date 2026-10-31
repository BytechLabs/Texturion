#!/usr/bin/env node
/**
 * rigd's commands, run under Node by type stripping on the rig:
 *
 *   node tools/rig/rigd/src/cli.ts daemon
 *   node tools/rig/rigd/src/cli.ts run <scenario>[-<run>] [--scheduled] [--run-id <id>]
 *   node tools/rig/rigd/src/cli.ts schedule --install | --out <dir> [--node <path>]
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
import { dialBudget } from "./budget.ts";
import { loadConfig } from "./config.ts";
import { deliverSecrets } from "./secrets.ts";
import { startDaemon } from "./daemon.ts";
import { installSchedule, userUnitDir } from "./install.ts";
import { loadRegistry } from "./registry.ts";
import { runScenario } from "./runner.ts";
import { NOT_RUNNABLE_YET, RUNNERS } from "./scenarios/index.ts";
import { buildSchedule, parseInstance } from "./schedule.ts";
import { VerdictStore } from "./verdicts.ts";
import { buildRig, marginsFileOf, rigdDir } from "./wiring.ts";

const CLI = fileURLToPath(import.meta.url);

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      scheduled: { type: "boolean" },
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
      const rig = buildRig(loadConfig());
      print(await runScenario(rig.runnerDeps(), id, { scheduled: values.scheduled, slot, runId: values["run-id"] }));
      return 0;
    }
    case "schedule": {
      if (!values.out && !values.install) throw new Error("schedule --install | --out <dir>");
      const rig = buildRig(loadConfig());
      const schedule = buildSchedule(rig.registry(), {
        window: await rig.windows().current(),
        runnable: new Set(Object.keys(RUNNERS)),
        notRunnable: NOT_RUNNABLE_YET,
        node: values.node ?? process.execPath,
        cli: CLI,
        home: rig.config.home.home,
      });
      if (values.install) {
        if (!rig.config.systemd) throw new Error("schedule --install: rig.json has systemd off");
        print({ ...installSchedule(schedule, { unitDir: userUnitDir() }), timed: schedule.timed, not_timed: schedule.notTimed });
        return 0;
      }
      mkdirSync(values.out!, { recursive: true });
      for (const unit of schedule.units) writeFileSync(join(values.out!, unit.name), unit.content);
      print({ timed: schedule.timed, not_timed: schedule.notTimed });
      return 0;
    }
    case "budget": {
      const config = loadConfig();
      const registry = loadRegistry(config.registryPath);
      print(dialBudget(registry, config.capsOverride ?? registry.budget));
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
      console.error("usage: cli.ts daemon | run <scenario> [--scheduled] [--run-id <id>] | schedule --install | --out <dir> | budget | verdicts | secrets | calibrate");
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
