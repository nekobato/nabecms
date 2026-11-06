import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectInstalledPackageNotices,
  finalizeAdminThirdPartyNotices,
  loadLicenseOverrides,
  renderThirdPartyNotices,
} from "./admin-third-party-notices.mjs";

/**
 * Create one package in a pnpm-compatible virtual store fixture.
 */
const createInstalledPackage = async ({ rootDir, name, version, notice }) => {
  const encodedName = name.replace("/", "+");
  const packageDirectory = path.join(
    rootDir,
    "node_modules",
    ".pnpm",
    `${encodedName}@${version}`,
    "node_modules",
    ...name.split("/"),
  );
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify({ name, version }, null, 2)}\n`,
    "utf8",
  );
  if (notice) {
    await writeFile(path.join(packageDirectory, "NOTICE.txt"), notice, "utf8");
  }
  return packageDirectory;
};

test("renderThirdPartyNotices sorts bundled packages and applies exact overrides", () => {
  const overrides = new Map([
    [
      "alpha@1.0.0",
      {
        identifier: "MIT",
        licenseText: "Alpha MIT license",
        notices: [{ name: "UPSTREAM_NOTICE.md", text: "Alpha notice" }],
      },
    ],
  ]);
  const noticesByPackage = new Map([
    ["zeta@2.0.0", [{ name: "NOTICE.txt", text: "Zeta notice" }]],
  ]);

  const output = renderThirdPartyNotices({
    entries: [
      {
        name: "zeta",
        version: "2.0.0",
        identifier: "BSD-2-Clause",
        text: "Zeta BSD license",
      },
      {
        name: "beta",
        version: "1.0.0",
        identifier: "BSD-3-Clause",
        text: "Beta BSD license",
      },
      {
        name: "@nekobato/nabecms-core",
        version: "1.0.0",
        identifier: "ISC",
        text: "First-party license",
      },
      { name: "alpha", version: "1.0.0", identifier: "MIT" },
    ],
    noticesByPackage,
    overrides,
  });

  assert.ok(
    output.indexOf("alpha - 1.0.0 [MIT]") <
      output.indexOf("zeta - 2.0.0 [BSD-2-Clause]"),
  );
  assert.match(output, /Alpha MIT license/u);
  assert.match(output, /Alpha notice/u);
  assert.match(output, /beta - 1\.0\.0 \[BSD-3-Clause\]/u);
  assert.match(output, /Beta BSD license/u);
  assert.match(output, /Zeta notice/u);
  assert.doesNotMatch(output, /First-party license/u);
  assert.doesNotMatch(output, /\/Users\/|node_modules\/\.pnpm|Generated at/u);
});

test("renderThirdPartyNotices fails closed for unreviewed or incomplete licenses", () => {
  assert.throws(
    () =>
      renderThirdPartyNotices({
        entries: [
          {
            name: "copyleft",
            version: "1.0.0",
            identifier: "GPL-3.0-only",
            text: "GPL text",
          },
        ],
      }),
    /unreviewed license identifier GPL-3\.0-only/u,
  );
  assert.throws(
    () =>
      renderThirdPartyNotices({
        entries: [{ name: "missing", version: "1.0.0", identifier: "MIT" }],
      }),
    /missing license text/u,
  );
  assert.throws(
    () =>
      renderThirdPartyNotices({
        entries: [
          {
            name: "../escape",
            version: "1.0.0",
            identifier: "MIT",
            text: "MIT text",
          },
        ],
      }),
    /invalid package name/u,
  );
});

test("loadLicenseOverrides reads pinned license and notice files", async () => {
  const overrideDirectory = await mkdtemp(
    path.join(os.tmpdir(), "nabecms-license-overrides-test-"),
  );
  await writeFile(
    path.join(overrideDirectory, "manifest.json"),
    `${JSON.stringify(
      [
        {
          name: "example",
          version: "1.0.0",
          identifier: "MIT",
          licenseFile: "LICENSE.txt",
          noticeFiles: ["NOTICE.txt"],
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(overrideDirectory, "LICENSE.txt"),
    "Pinned MIT license\n",
    "utf8",
  );
  await writeFile(
    path.join(overrideDirectory, "NOTICE.txt"),
    "Pinned upstream notice\n",
    "utf8",
  );

  const overrides = await loadLicenseOverrides({ overrideDirectory });

  assert.deepEqual(overrides.get("example@1.0.0"), {
    identifier: "MIT",
    licenseText: "Pinned MIT license",
    notices: [{ name: "NOTICE.txt", text: "Pinned upstream notice" }],
  });
});

test("collectInstalledPackageNotices reads NOTICE files for bundled packages", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "nabecms-installed-notices-test-"),
  );
  await createInstalledPackage({
    rootDir,
    name: "example",
    version: "1.0.0",
    notice: "Installed package notice\n",
  });

  const notices = await collectInstalledPackageNotices({
    entries: [
      {
        name: "example",
        version: "1.0.0",
        identifier: "MIT",
        text: "MIT license",
      },
    ],
    rootDir,
  });

  assert.deepEqual(notices.get("example@1.0.0"), [
    { name: "NOTICE.txt", text: "Installed package notice" },
  ]);
});

test("finalizeAdminThirdPartyNotices atomically replaces raw Vite metadata", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "nabecms-finalize-notices-test-"),
  );
  const distDirectory = path.join(rootDir, "dist");
  const rawInventoryPath = path.join(
    distDirectory,
    ".vite",
    "third-party-licenses.json",
  );
  const outputPath = path.join(distDirectory, "THIRD_PARTY_NOTICES.txt");
  const overrideDirectory = path.join(rootDir, "overrides");
  await mkdir(path.dirname(rawInventoryPath), { recursive: true });
  await mkdir(overrideDirectory, { recursive: true });
  await createInstalledPackage({
    rootDir,
    name: "example",
    version: "1.0.0",
  });
  await writeFile(
    rawInventoryPath,
    `${JSON.stringify(
      [
        {
          name: "example",
          version: "1.0.0",
          identifier: "MIT",
          text: "MIT license",
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(overrideDirectory, "manifest.json"),
    "[]\n",
    "utf8",
  );

  const result = await finalizeAdminThirdPartyNotices({
    outputPath,
    overrideDirectory,
    rawInventoryPath,
    rootDir,
  });

  assert.equal(result.packageCount, 1);
  assert.match(await readFile(outputPath, "utf8"), /example - 1\.0\.0/u);
  await assert.rejects(readFile(rawInventoryPath, "utf8"), { code: "ENOENT" });
});
