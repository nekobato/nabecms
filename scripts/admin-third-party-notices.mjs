/**
 * Finalize Vite's bundle-derived license inventory into a reviewed notice file.
 *
 * @module admin-third-party-notices
 */

import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const reviewedLicenseIdentifiers = new Set([
  "(MPL-2.0 OR Apache-2.0)",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MIT",
]);
const noticeFilenamePattern =
  /^(?:notice|third[-_. ]?party[-_. ]?notices?)(?:$|[-_. ])/iu;

/**
 * Normalize text files without changing their legal wording.
 */
const normalizeText = (value) =>
  typeof value === "string"
    ? value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim()
    : "";

/**
 * Compare strings using deterministic code-point ordering.
 */
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Build the stable package key used by Vite and the override manifest.
 */
const toPackageKey = ({ name, version }) => `${name}@${version}`;

/**
 * Return whether a package belongs to this repository rather than a third party.
 */
const isFirstPartyPackage = (name) =>
  name === "nabecms" ||
  name === "create-nabecms" ||
  name.startsWith("@nekobato/");

/**
 * Reject package names that could escape a node_modules package directory.
 */
const assertSafePackageName = (name) => {
  const segments = name.split("/");
  const hasExpectedShape = name.startsWith("@")
    ? segments.length === 2 && segments[0].length > 1 && segments[1].length > 0
    : segments.length === 1 && segments[0].length > 0;
  if (
    !hasExpectedShape ||
    name.includes("\\") ||
    name.includes("\u0000") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      `Vite license inventory contains invalid package name ${name}.`,
    );
  }
};

/**
 * Read and parse a JSON file with a path-specific failure message.
 */
const readJson = async (filename) => {
  const source = await readFile(filename, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Could not parse JSON file ${filename}.`, { cause: error });
  }
};

/**
 * Read directory entries, returning an empty list only when the directory is absent.
 */
const readDirectory = async (directory) => {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

/**
 * Reject absolute or parent-traversing paths from the override manifest.
 */
const resolveOverrideFile = (overrideDirectory, relativeFilename) => {
  if (
    typeof relativeFilename !== "string" ||
    relativeFilename.length === 0 ||
    path.isAbsolute(relativeFilename) ||
    relativeFilename.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`Invalid license override file path: ${relativeFilename}.`);
  }
  return path.join(overrideDirectory, relativeFilename);
};

/**
 * Normalize one notice entry and reject empty notice text.
 */
const normalizeNotice = ({ name, text }, packageKey) => {
  const normalizedName = normalizeText(name);
  const normalizedText = normalizeText(text);
  if (!normalizedName || !normalizedText) {
    throw new Error(`Package ${packageKey} has an empty NOTICE file.`);
  }
  return { name: normalizedName, text: normalizedText };
};

/**
 * Validate a Vite license entry and resolve any reviewed missing-text override.
 */
const normalizeLicenseEntry = ({ entry, override }) => {
  const name = normalizeText(entry?.name);
  const version = normalizeText(entry?.version);
  const identifier = normalizeText(entry?.identifier);
  if (!name || !version) {
    throw new Error(
      "Vite license inventory contains an unnamed package or version.",
    );
  }
  assertSafePackageName(name);
  const packageKey = toPackageKey({ name, version });
  if (!identifier) {
    throw new Error(`Package ${packageKey} is missing a license identifier.`);
  }
  if (!reviewedLicenseIdentifiers.has(identifier)) {
    throw new Error(
      `Package ${packageKey} uses unreviewed license identifier ${identifier}.`,
    );
  }
  if (override && override.identifier !== identifier) {
    throw new Error(
      `Package ${packageKey} license identifier differs from its reviewed override.`,
    );
  }

  const bundledLicenseText = normalizeText(entry?.text);
  const overrideLicenseText = normalizeText(override?.licenseText);
  if (
    bundledLicenseText &&
    overrideLicenseText &&
    bundledLicenseText !== overrideLicenseText
  ) {
    throw new Error(
      `Package ${packageKey} license text differs from its reviewed override.`,
    );
  }
  const licenseText = bundledLicenseText || overrideLicenseText;
  if (!licenseText) {
    throw new Error(`Package ${packageKey} is missing license text.`);
  }

  return { identifier, licenseText, name, packageKey, version };
};

/**
 * Render a deterministic aggregate notice from Vite's actual bundle inventory.
 */
export const renderThirdPartyNotices = ({
  entries,
  noticesByPackage = new Map(),
  overrides = new Map(),
}) => {
  if (!Array.isArray(entries)) {
    throw new Error("Vite license inventory must be a JSON array.");
  }

  const thirdPartyEntries = entries.filter(
    (entry) => !isFirstPartyPackage(normalizeText(entry?.name)),
  );
  const presentKeys = new Set(
    thirdPartyEntries.map((entry) =>
      toPackageKey({
        name: normalizeText(entry?.name),
        version: normalizeText(entry?.version),
      }),
    ),
  );
  for (const overrideKey of overrides.keys()) {
    if (!presentKeys.has(overrideKey)) {
      throw new Error(
        `License override ${overrideKey} is no longer used by the bundle.`,
      );
    }
  }

  const seenKeys = new Set();
  const normalizedEntries = thirdPartyEntries
    .map((entry) => {
      const initialKey = toPackageKey({
        name: normalizeText(entry?.name),
        version: normalizeText(entry?.version),
      });
      const normalized = normalizeLicenseEntry({
        entry,
        override: overrides.get(initialKey),
      });
      if (seenKeys.has(normalized.packageKey)) {
        throw new Error(
          `Vite license inventory contains duplicate package ${normalized.packageKey}.`,
        );
      }
      seenKeys.add(normalized.packageKey);

      const noticeCandidates = [
        ...(noticesByPackage.get(normalized.packageKey) ?? []),
        ...(overrides.get(normalized.packageKey)?.notices ?? []),
      ]
        .map((notice) => normalizeNotice(notice, normalized.packageKey))
        .sort((left, right) =>
          compareText(
            `${left.name}\u0000${left.text}`,
            `${right.name}\u0000${right.text}`,
          ),
        );
      const seenNoticeTexts = new Set();
      const notices = noticeCandidates.filter(({ text }) => {
        if (seenNoticeTexts.has(text)) return false;
        seenNoticeTexts.add(text);
        return true;
      });
      return { ...normalized, notices };
    })
    .sort((left, right) => compareText(left.packageKey, right.packageKey));

  const sections = normalizedEntries.map(
    ({ identifier, licenseText, name, notices, version }) => {
      const noticeSections = notices.map(
        (notice) =>
          `NOTICE: ${notice.name}\n${"-".repeat(80)}\n\n${notice.text}`,
      );
      return [
        `${name} - ${version} [${identifier}]`,
        "=".repeat(80),
        licenseText,
        ...noticeSections,
      ].join("\n\n");
    },
  );

  return `${[
    "THIRD-PARTY NOTICES",
    "",
    "Generated from the dependencies included in the NabeCMS Admin production bundle.",
    "Do not edit this file by hand; update the dependency or reviewed override instead.",
    "",
    ...sections,
  ].join("\n")}\n`;
};

/**
 * Load exact-version license and NOTICE overrides from source-controlled files.
 */
export const loadLicenseOverrides = async ({ overrideDirectory }) => {
  const manifestPath = path.join(overrideDirectory, "manifest.json");
  const manifest = await readJson(manifestPath);
  if (!Array.isArray(manifest)) {
    throw new Error(
      `License override manifest ${manifestPath} must be an array.`,
    );
  }

  const overrides = new Map();
  for (const entry of manifest) {
    const name = normalizeText(entry?.name);
    const version = normalizeText(entry?.version);
    const identifier = normalizeText(entry?.identifier);
    if (!name || !version || !identifier) {
      throw new Error(
        "License override manifest has an incomplete package entry.",
      );
    }
    const packageKey = toPackageKey({ name, version });
    if (overrides.has(packageKey)) {
      throw new Error(`License override manifest duplicates ${packageKey}.`);
    }
    const licensePath = resolveOverrideFile(
      overrideDirectory,
      entry.licenseFile,
    );
    const licenseText = normalizeText(await readFile(licensePath, "utf8"));
    if (!licenseText) {
      throw new Error(`License override ${packageKey} has empty license text.`);
    }
    const noticeFiles = entry.noticeFiles ?? [];
    if (!Array.isArray(noticeFiles)) {
      throw new Error(
        `License override ${packageKey} noticeFiles must be an array.`,
      );
    }
    const notices = [];
    for (const noticeFilename of noticeFiles) {
      const noticePath = resolveOverrideFile(overrideDirectory, noticeFilename);
      notices.push(
        normalizeNotice(
          {
            name: noticeFilename,
            text: await readFile(noticePath, "utf8"),
          },
          packageKey,
        ),
      );
    }
    overrides.set(packageKey, { identifier, licenseText, notices });
  }
  return overrides;
};

/**
 * Read a package manifest when a candidate package directory exists.
 */
const readPackageIdentity = async (packageDirectory) => {
  try {
    const manifest = await readJson(
      path.join(packageDirectory, "package.json"),
    );
    return {
      directory: await realpath(packageDirectory),
      name: manifest.name,
      version: manifest.version,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};

/**
 * Find exact package instances in this repository's pnpm virtual store.
 */
const findInstalledPackageDirectories = async ({
  name,
  rootDir,
  version,
  virtualStoreEntries,
}) => {
  const virtualStoreDirectory = path.join(rootDir, "node_modules", ".pnpm");
  const encodedName = name.replace("/", "+");
  const virtualStorePrefix = `${encodedName}@${version}`;
  const candidates = [
    path.join(rootDir, "node_modules", ...name.split("/")),
    path.join(
      rootDir,
      "packages",
      "nabecms-admin",
      "node_modules",
      ...name.split("/"),
    ),
    ...virtualStoreEntries
      .filter(
        ({ isDirectory, entryName }) =>
          isDirectory &&
          (entryName === virtualStorePrefix ||
            entryName.startsWith(`${virtualStorePrefix}_`)),
      )
      .map(({ entryName }) =>
        path.join(
          virtualStoreDirectory,
          entryName,
          "node_modules",
          ...name.split("/"),
        ),
      ),
  ];

  const directories = new Set();
  for (const candidate of candidates) {
    const identity = await readPackageIdentity(candidate);
    if (identity?.name === name && identity.version === version) {
      directories.add(identity.directory);
    }
  }
  if (directories.size === 0) {
    throw new Error(
      `Could not locate bundled package ${name}@${version} for NOTICE inspection.`,
    );
  }
  return [...directories].sort(compareText);
};

/**
 * Read top-level NOTICE files from one exact installed package instance.
 */
const readPackageNotices = async (packageDirectory) => {
  const entries = await readDirectory(packageDirectory);
  const notices = [];
  for (const entry of entries.sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    if (!noticeFilenamePattern.test(entry.name)) continue;
    const noticePath = path.join(packageDirectory, entry.name);
    const noticeStat = await stat(noticePath);
    if (!noticeStat.isFile()) continue;
    notices.push(
      normalizeNotice(
        { name: entry.name, text: await readFile(noticePath, "utf8") },
        packageDirectory,
      ),
    );
  }
  return notices;
};

/**
 * Collect NOTICE files only for packages present in Vite's actual bundle graph.
 */
export const collectInstalledPackageNotices = async ({ entries, rootDir }) => {
  if (!Array.isArray(entries)) {
    throw new Error("Vite license inventory must be a JSON array.");
  }
  const virtualStoreDirectory = path.join(rootDir, "node_modules", ".pnpm");
  const virtualStoreEntries = (await readDirectory(virtualStoreDirectory)).map(
    (entry) => ({ entryName: entry.name, isDirectory: entry.isDirectory() }),
  );
  const noticesByPackage = new Map();

  for (const entry of entries) {
    const name = normalizeText(entry?.name);
    const version = normalizeText(entry?.version);
    if (isFirstPartyPackage(name)) continue;
    if (!name || !version) {
      throw new Error(
        "Vite license inventory contains an unnamed package or version.",
      );
    }
    assertSafePackageName(name);
    const packageKey = toPackageKey({ name, version });
    const packageDirectories = await findInstalledPackageDirectories({
      name,
      rootDir,
      version,
      virtualStoreEntries,
    });
    const notices = [];
    for (const packageDirectory of packageDirectories) {
      notices.push(...(await readPackageNotices(packageDirectory)));
    }
    if (notices.length > 0) {
      const deduplicated = new Map(
        notices.map((notice) => [`${notice.name}\u0000${notice.text}`, notice]),
      );
      noticesByPackage.set(
        packageKey,
        [...deduplicated.values()].sort((left, right) =>
          compareText(
            `${left.name}\u0000${left.text}`,
            `${right.name}\u0000${right.text}`,
          ),
        ),
      );
    }
  }
  return noticesByPackage;
};

/**
 * Replace Vite's raw JSON inventory with the final distributable notice file.
 */
export const finalizeAdminThirdPartyNotices = async ({
  outputPath,
  overrideDirectory,
  rawInventoryPath,
  rootDir,
}) => {
  const entries = await readJson(rawInventoryPath);
  const [noticesByPackage, overrides] = await Promise.all([
    collectInstalledPackageNotices({ entries, rootDir }),
    loadLicenseOverrides({ overrideDirectory }),
  ]);
  const output = renderThirdPartyNotices({
    entries,
    noticesByPackage,
    overrides,
  });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, output, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  await rm(rawInventoryPath, { force: true });

  return {
    outputPath,
    packageCount: new Set(
      entries
        .filter((entry) => !isFirstPartyPackage(normalizeText(entry?.name)))
        .map((entry) =>
          toPackageKey({
            name: normalizeText(entry?.name),
            version: normalizeText(entry?.version),
          }),
        ),
    ).size,
  };
};

const repositoryRoot = path.resolve(import.meta.dirname, "..");

/**
 * Finalize the repository's default Admin build and report a path-only summary.
 */
const runCli = async () => {
  const adminDirectory = path.join(repositoryRoot, "packages", "nabecms-admin");
  const result = await finalizeAdminThirdPartyNotices({
    outputPath: path.join(adminDirectory, "dist", "THIRD_PARTY_NOTICES.txt"),
    overrideDirectory: path.join(
      adminDirectory,
      "third-party-license-overrides",
    ),
    rawInventoryPath: path.join(
      adminDirectory,
      "dist",
      ".vite",
      "third-party-licenses.json",
    ),
    rootDir: repositoryRoot,
  });
  console.log(
    `Generated ${path.relative(repositoryRoot, result.outputPath)} for ${result.packageCount} bundled packages.`,
  );
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli();
}
