#!/usr/bin/env node
import { main } from "../src/cli.mjs";

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  // `rig health` reserves exit 1 for completed checks with failures.
  process.exit(70);
}
