#!/usr/bin/env node
import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    // Not 1: `rig health` exits 1 for failed checks, which its unit counts as
    // a result. A command that could not run at all must fail the unit.
    process.exit(70);
  },
);
