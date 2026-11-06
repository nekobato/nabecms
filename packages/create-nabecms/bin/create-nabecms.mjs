#!/usr/bin/env node

import process from "node:process";
import { formatCreateHelp, runCreateNabeCms } from "../lib/create-project.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(formatCreateHelp());
  process.exit(0);
}

process.exitCode = await runCreateNabeCms({
  argv: process.argv.slice(2),
});
