import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDoctorCommand } from "../lib/doctor.mjs";
import { parseMigrateOptions } from "../lib/migrate.mjs";

test("parseMigrateOptions handles local and remote flags", () => {
  assert.deepEqual(parseMigrateOptions([]), {
    binding: "DB",
    environment: undefined,
    preview: false,
    persistTo: undefined,
    mode: "local",
  });

  assert.deepEqual(
    parseMigrateOptions([
      "--remote",
      "--env",
      "production",
      "--binding",
      "CMS_DB",
      "--preview",
      "--persist-to",
      ".wrangler/state",
    ]),
    {
      binding: "CMS_DB",
      environment: "production",
      preview: true,
      persistTo: ".wrangler/state",
      mode: "remote",
    },
  );
});

test("runDoctorCommand validates a minimal host app", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nabecms-cli-doctor-"),
  );
  const output = [];

  await fs.writeFile(
    path.join(tempRoot, "nabecms.config.ts"),
    [
      'import { defineConfig } from "@nekobato/nabecms";',
      "",
      "export default defineConfig({});",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(tempRoot, "wrangler.jsonc"),
    `{
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  },
  "ratelimits": [
    {
      "name": "AUTH_LOGIN_RATE_LIMITER",
      "namespace_id": "10001",
      "simple": { "limit": 10, "period": 60 }
    },
    {
      "name": "AUTH_SENSITIVE_RATE_LIMITER",
      "namespace_id": "10002",
      "simple": { "limit": 5, "period": 60 }
    }
  ],
  "vars": {
    "WORKER_ENV": "development",
    "ADMIN_DEV_PROXY": "false",
    "BETTER_AUTH_URL": "http://localhost:8787"
  },
  "env": {
    "production": {
      "ratelimits": [
        {
          "name": "AUTH_LOGIN_RATE_LIMITER",
          "namespace_id": "11001",
          "simple": { "limit": 10, "period": 60 }
        },
        {
          "name": "AUTH_SENSITIVE_RATE_LIMITER",
          "namespace_id": "11002",
          "simple": { "limit": 5, "period": 60 }
        }
      ],
      "vars": {
        "WORKER_ENV": "production",
        "BETTER_AUTH_URL": "https://example.workers.dev"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "migrations_dir": "./migrations"
        }
      ],
      "r2_buckets": [
        {
          "binding": "R2"
        }
      ]
    }
  },
  "d1_databases": [
    {
      "binding": "DB",
      "migrations_dir": "./migrations"
    }
  ],
  "r2_buckets": [
    {
      "binding": "R2"
    }
  ]
}`,
  );
  await fs.writeFile(
    path.join(tempRoot, ".dev.vars.example"),
    "JWT_SECRET=replace-with-random-secret\n",
  );
  await fs.writeFile(path.join(tempRoot, ".dev.vars"), "JWT_SECRET=secret\n");

  const exitCode = await runDoctorCommand({
    projectRoot: tempRoot,
    corePackageRoot: path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "nabecms-core",
    ),
    stdout: (line) => output.push(line),
    stderr: (line) => output.push(line),
  });

  assert.equal(exitCode, 0);
  assert.match(output.join("\n"), /Summary: 0 error\(s\)/u);
});
