#!/usr/bin/env node
import { main } from "../src/cli.mjs";

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  // The unit treats a failed health check as a result and a failed invocation as an error.
  process.exit(70);
}
