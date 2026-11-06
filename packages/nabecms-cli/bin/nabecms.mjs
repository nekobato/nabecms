#!/usr/bin/env node

import process from "node:process";
import {
  formatBundleMigrationsHelp,
  runBundleMigrationsCommand,
} from "../lib/bundle-migrations.mjs";
import { formatDoctorHelp, runDoctorCommand } from "../lib/doctor.mjs";
import { formatMigrateHelp, runMigrateCommand } from "../lib/migrate.mjs";

/**
 * Print the top-level CLI usage.
 */
const printHelp = () => {
  console.log(`Usage: nabecms <command> [options]

Commands:
  doctor             Validate host app bindings, env files, and config
  migrate            Apply D1 migrations and refresh the runtime bundle
  bundle-migrations  Regenerate src/database/runtime-migrations.generated.ts

Run "nabecms <command> --help" for command-specific options.`);
};

const [, , command, ...argv] = process.argv;

switch (command) {
  case undefined:
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "doctor":
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(formatDoctorHelp());
      break;
    }
    process.exitCode = await runDoctorCommand({ argv });
    break;
  case "migrate":
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(formatMigrateHelp());
      break;
    }
    process.exitCode = await runMigrateCommand({ argv });
    break;
  case "bundle-migrations":
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(formatBundleMigrationsHelp());
      break;
    }
    process.exitCode = await runBundleMigrationsCommand({ argv });
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    break;
}
