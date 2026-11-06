import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Create a temporary CommonJS workspace used to evaluate TypeScript config files.
 */
const createTempWorkspace = (projectRoot) => {
  const tempRoot = fs.mkdtempSync(
    path.join(projectRoot, ".nabecms-doctor-workspace-"),
  );
  fs.writeFileSync(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ type: "commonjs" }, null, 2),
    "utf8",
  );
  return tempRoot;
};

/**
 * Resolve a relative or absolute module specifier to a source file on disk.
 */
const resolveSourceModule = (sourceFile, specifier) => {
  const fromDirectory = path.dirname(sourceFile);
  const candidateBase = specifier.startsWith("/")
    ? specifier
    : path.resolve(fromDirectory, specifier);
  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}.js`,
    `${candidateBase}.mjs`,
    `${candidateBase}.cjs`,
    path.join(candidateBase, "index.ts"),
    path.join(candidateBase, "index.tsx"),
    path.join(candidateBase, "index.js"),
    path.join(candidateBase, "index.mjs"),
    path.join(candidateBase, "index.cjs"),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(
      `Failed to resolve module "${specifier}" from "${sourceFile}"`,
    );
  }

  return resolved;
};

/**
 * Read import and export specifiers from a TypeScript source file.
 */
const collectModuleSpecifiers = (sourceFile) => {
  const specifiers = [];

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push({
        start: node.moduleSpecifier.getStart(sourceFile) + 1,
        end: node.moduleSpecifier.getEnd() - 1,
        value: node.moduleSpecifier.text,
      });
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push({
        start: node.moduleSpecifier.getStart(sourceFile) + 1,
        end: node.moduleSpecifier.getEnd() - 1,
        value: node.moduleSpecifier.text,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};

/**
 * Resolve the installed core package root from the facade or direct package.
 */
const resolveCorePackageRoot = (projectRoot) => {
  const projectRequire = createRequire(path.join(projectRoot, "package.json"));
  try {
    const resolvedEntry = projectRequire.resolve("@nekobato/nabecms-core");
    return path.resolve(path.dirname(resolvedEntry), "..");
  } catch {
    const facadeEntry = projectRequire.resolve("@nekobato/nabecms");
    const facadeRoot = path.resolve(path.dirname(facadeEntry), "..");
    const facadeRequire = createRequire(path.join(facadeRoot, "package.json"));
    const resolvedEntry = facadeRequire.resolve("@nekobato/nabecms-core");
    return path.resolve(path.dirname(resolvedEntry), "..");
  }
};

/**
 * Choose one output file location in the temporary CommonJS workspace.
 */
const toCompiledOutputPath = ({
  sourceFilePath,
  tempRoot,
  projectRoot,
  corePackageRoot,
}) => {
  const normalizedSource = path.resolve(sourceFilePath);
  const sourceRoot = [
    { prefix: projectRoot, label: "project" },
    { prefix: corePackageRoot, label: "core" },
  ].find(
    ({ prefix }) =>
      normalizedSource === prefix ||
      normalizedSource.startsWith(`${prefix}${path.sep}`),
  );

  if (sourceRoot) {
    return path.join(
      tempRoot,
      sourceRoot.label,
      path
        .relative(sourceRoot.prefix, normalizedSource)
        .replace(/\.[^.]+$/u, ".js"),
    );
  }

  return path.join(
    tempRoot,
    "misc",
    normalizedSource
      .replace(/^([A-Za-z]:)?[\\/]/u, "")
      .replace(/[\\/:\s]/gu, "_")
      .replace(/\.[^.]+$/u, ".js"),
  );
};

/**
 * Compile one module graph to a temporary CommonJS workspace.
 */
const compileModuleGraph = ({
  entryFile,
  tempRoot,
  projectRoot,
  corePackageRoot,
  rewriteBareImports = {},
}) => {
  const compiled = new Map();

  const compileFile = (sourceFilePath) => {
    const normalizedSource = path.resolve(sourceFilePath);
    const existing = compiled.get(normalizedSource);
    if (existing) return existing;

    const sourceText = fs.readFileSync(normalizedSource, "utf8");
    const sourceFile = ts.createSourceFile(
      normalizedSource,
      sourceText,
      ts.ScriptTarget.ES2022,
      true,
    );
    const outputFilePath = toCompiledOutputPath({
      sourceFilePath: normalizedSource,
      tempRoot,
      projectRoot,
      corePackageRoot,
    });
    const replacements = collectModuleSpecifiers(sourceFile).map(
      (specifier) => {
        if (
          specifier.value.startsWith(".") ||
          specifier.value.startsWith("/") ||
          specifier.value.startsWith("..")
        ) {
          const resolvedDependency = resolveSourceModule(
            normalizedSource,
            specifier.value,
          );
          const compiledDependency = compileFile(resolvedDependency);
          const replacement = path
            .relative(path.dirname(outputFilePath), compiledDependency)
            .replace(/\.[^.]+$/u, "")
            .replace(/\\/gu, "/");
          return {
            ...specifier,
            replacement: replacement.startsWith(".")
              ? replacement
              : `./${replacement}`,
          };
        }

        if (rewriteBareImports[specifier.value]) {
          const rewritten = path
            .relative(
              path.dirname(outputFilePath),
              rewriteBareImports[specifier.value],
            )
            .replace(/\.[^.]+$/u, "")
            .replace(/\\/gu, "/");
          return {
            ...specifier,
            replacement: rewritten.startsWith(".")
              ? rewritten
              : `./${rewritten}`,
          };
        }

        if (specifier.value.startsWith("node:")) {
          return {
            ...specifier,
            replacement: specifier.value,
          };
        }

        const resolvedBareImport = createRequire(normalizedSource).resolve(
          specifier.value,
        );

        return {
          ...specifier,
          replacement: resolvedBareImport.replace(/\\/gu, "/"),
        };
      },
    );

    const rewrittenSource = replacements
      .sort((left, right) => right.start - left.start)
      .reduce(
        (current, replacement) =>
          `${current.slice(0, replacement.start)}${replacement.replacement}${current.slice(replacement.end)}`,
        sourceText,
      );

    const transpiled = ts.transpileModule(rewrittenSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: normalizedSource,
    });

    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    fs.writeFileSync(outputFilePath, transpiled.outputText, "utf8");
    compiled.set(normalizedSource, outputFilePath);
    return outputFilePath;
  };

  return compileFile(entryFile);
};

/**
 * Create a shim for config/plugin helper imports from the core package.
 */
const writeCoreShim = (tempRoot) => {
  const shimPath = path.join(tempRoot, "__shims__", "nabecms-core.js");
  fs.mkdirSync(path.dirname(shimPath), { recursive: true });
  fs.writeFileSync(
    shimPath,
    [
      "exports.defineConfig = (config) => config;",
      "exports.definePlugin = (plugin) => plugin;",
    ].join("\n"),
    "utf8",
  );
  return shimPath;
};

/**
 * Load the host app wrangler.jsonc using the TypeScript JSONC parser.
 */
const loadWranglerConfig = (projectRoot) => {
  const wranglerPath = path.join(projectRoot, "wrangler.jsonc");
  if (!fs.existsSync(wranglerPath)) return undefined;

  const parsed = ts.parseConfigFileTextToJson(
    wranglerPath,
    fs.readFileSync(wranglerPath, "utf8"),
  );
  if (parsed.error) {
    const message = ts.flattenDiagnosticMessageText(
      parsed.error.messageText,
      "\n",
    );
    throw new Error(`Failed to parse wrangler.jsonc: ${message}`);
  }
  return parsed.config;
};

/**
 * Parse a dotenv-like file into a flat key/value map.
 */
const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return undefined;

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex < 0) return acc;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key.length === 0) return acc;
      acc[key] = value;
      return acc;
    }, {});
};

/**
 * Load host app config if present, otherwise return an empty object.
 */
const loadHostConfig = ({
  projectRoot,
  tempRoot,
  corePackageRoot,
  shimPath,
}) => {
  const configEntry = path.join(projectRoot, "nabecms.config.ts");
  if (!fs.existsSync(configEntry)) {
    return {};
  }

  const compiledConfigPath = compileModuleGraph({
    entryFile: configEntry,
    tempRoot,
    projectRoot,
    corePackageRoot,
    rewriteBareImports: {
      "@nekobato/nabecms": shimPath,
      "@nekobato/nabecms-core": shimPath,
    },
  });

  const configModule = require(compiledConfigPath);
  return configModule.default ?? configModule;
};

/**
 * Format one doctor issue as a terminal-friendly line.
 */
const formatIssue = (issue) =>
  `[${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`;

/**
 * Format help for the doctor command.
 */
export const formatDoctorHelp = () => `Usage: nabecms doctor

Validates the current host app by checking:
  - wrangler.jsonc bindings and vars
  - local .dev.vars and .dev.vars.example
  - nabecms.config.ts compatibility with the public config contract`;

/**
 * Run the doctor command.
 */
export const runDoctorCommand = async ({
  projectRoot = process.cwd(),
  corePackageRoot = resolveCorePackageRoot(projectRoot),
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const tempRoot = createTempWorkspace(projectRoot);

  try {
    const shimPath = writeCoreShim(tempRoot);
    const compiledDoctorPath = compileModuleGraph({
      entryFile: path.join(corePackageRoot, "src", "doctor.ts"),
      tempRoot,
      projectRoot,
      corePackageRoot,
    });

    const doctorModule = require(compiledDoctorPath);
    const { runDoctor } = doctorModule;
    const config = loadHostConfig({
      projectRoot,
      tempRoot,
      corePackageRoot,
      shimPath,
    });

    const report = runDoctor({
      config,
      wranglerConfig: loadWranglerConfig(projectRoot),
      envState: {
        devVars: parseEnvFile(path.join(projectRoot, ".dev.vars")),
        devVarsExample: parseEnvFile(
          path.join(projectRoot, ".dev.vars.example"),
        ),
      },
    });

    stdout("NabeCMS doctor");
    report.issues.forEach((issue) => {
      stdout(formatIssue(issue));
    });
    stdout(
      `Summary: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.infos} info(s)`,
    );

    return report.ok ? 0 : 1;
  } catch (error) {
    stderr("NabeCMS doctor");
    stderr(
      `[ERROR] DOCTOR_RUNTIME_FAILURE: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};
