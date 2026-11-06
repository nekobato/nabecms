import type { NabeCmsConfig } from "./config";

type BindingRecord = {
  binding?: string;
  migrations_dir?: string;
};

type RateLimitRecord = {
  name?: string;
  namespace_id?: string;
  simple?: {
    limit?: number;
    period?: number;
  };
};

type WranglerEnvironmentRecord = {
  assets?: {
    binding?: string;
    not_found_handling?: string;
    run_worker_first?: boolean | string[];
  };
  vars?: Record<string, string>;
  d1_databases?: BindingRecord[];
  r2_buckets?: BindingRecord[];
  ratelimits?: RateLimitRecord[];
  durable_objects?: {
    bindings?: Array<{
      name?: string;
      class_name?: string;
    }>;
  };
};

type WranglerConfigRecord = {
  assets?: {
    binding?: string;
    not_found_handling?: string;
    run_worker_first?: boolean | string[];
  };
  d1_databases?: BindingRecord[];
  r2_buckets?: BindingRecord[];
  ratelimits?: RateLimitRecord[];
  durable_objects?: {
    bindings?: Array<{
      name?: string;
      class_name?: string;
    }>;
  };
  vars?: Record<string, string>;
  env?: Record<string, WranglerEnvironmentRecord>;
};

/**
 * Severity level for doctor findings.
 */
export type DoctorIssueSeverity = "error" | "warning" | "info";

/**
 * Stable issue code emitted by the doctor report.
 */
export type DoctorIssueCode =
  | "CONFIG_OK"
  | "WRANGLER_CONFIG_MISSING"
  | "WRANGLER_ASSETS_BINDING_MISSING"
  | "WRANGLER_ASSETS_SPA_FALLBACK_MISSING"
  | "WRANGLER_ASSETS_WORKER_FIRST_REQUIRED"
  | "WRANGLER_DB_BINDING_MISSING"
  | "WRANGLER_R2_BINDING_MISSING"
  | "WRANGLER_RATE_LIMIT_BINDING_MISSING"
  | "WRANGLER_RATE_LIMIT_CONFIG_INVALID"
  | "WRANGLER_RATE_LIMIT_NAMESPACE_SHARED"
  | "WRANGLER_MIGRATIONS_DIR_UNEXPECTED"
  | "WRANGLER_VAR_MISSING"
  | "LOCAL_DEV_VARS_FILE_MISSING"
  | "LOCAL_DEV_VARS_TEMPLATE_MISSING"
  | "LOCAL_ENV_SECRET_MISSING"
  | "LOCAL_ENV_TEMPLATE_KEY_MISSING";

/**
 * One doctor finding.
 */
export type DoctorIssue = {
  severity: DoctorIssueSeverity;
  code: DoctorIssueCode;
  message: string;
};

/**
 * Structured doctor output.
 */
export type DoctorReport = {
  ok: boolean;
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  issues: DoctorIssue[];
};

/**
 * Inputs accepted by the doctor.
 */
export type DoctorInput = {
  config?: NabeCmsConfig;
  wranglerConfig?: unknown;
  envState?: {
    devVars?: Record<string, string>;
    devVarsExample?: Record<string, string>;
  };
};

/**
 * Collect all binding names declared in the root and environment-scoped wrangler config.
 */
const collectBindingNames = (
  wranglerConfig: WranglerConfigRecord,
): {
  assetsBindings: Set<string>;
  d1Bindings: Set<string>;
  durableObjectBindings: Set<string>;
  r2Bindings: Set<string>;
  d1MigrationDirs: Map<string, Set<string>>;
} => {
  const assetsBindings = new Set<string>();
  const d1Bindings = new Set<string>();
  const durableObjectBindings = new Set<string>();
  const r2Bindings = new Set<string>();
  const d1MigrationDirs = new Map<string, Set<string>>();

  const collectD1Record = (entry: BindingRecord) => {
    if (!entry.binding) return;
    d1Bindings.add(entry.binding);
    if (!entry.migrations_dir) return;

    const current = d1MigrationDirs.get(entry.binding) ?? new Set<string>();
    current.add(entry.migrations_dir);
    d1MigrationDirs.set(entry.binding, current);
  };

  const collectEnvironment = (record?: WranglerEnvironmentRecord) => {
    if (!record) return;
    if (record.assets?.binding) {
      assetsBindings.add(record.assets.binding);
    }
    record.d1_databases?.forEach(collectD1Record);
    record.durable_objects?.bindings?.forEach((entry) => {
      if (entry.name) durableObjectBindings.add(entry.name);
    });
    record.r2_buckets?.forEach((entry) => {
      if (entry.binding) r2Bindings.add(entry.binding);
    });
  };

  collectEnvironment(wranglerConfig);
  Object.values(wranglerConfig.env ?? {}).forEach(collectEnvironment);

  return {
    assetsBindings,
    d1Bindings,
    durableObjectBindings,
    r2Bindings,
    d1MigrationDirs,
  };
};

const parseBooleanFlag = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return fallback;
  return normalized === "true";
};

const hasNonEmptyValue = (
  record: Record<string, string> | undefined,
  key: string,
): boolean => {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0;
};

/**
 * Normalize an unknown wrangler config into the small shape used by the doctor.
 */
const normalizeWranglerConfig = (
  value: unknown,
): WranglerConfigRecord | undefined => {
  if (!value || typeof value !== "object") return undefined;
  return value as WranglerConfigRecord;
};

const AUTH_RATE_LIMIT_EXPECTATIONS = [
  {
    name: "AUTH_LOGIN_RATE_LIMITER",
    limit: 10,
    period: 60,
  },
  {
    name: "AUTH_SENSITIVE_RATE_LIMITER",
    limit: 5,
    period: 60,
  },
] as const;

/**
 * Validate one wrangler environment's required auth rate limit bindings.
 */
const inspectAuthRateLimitEnvironment = (
  environmentName: "root" | "production",
  records: RateLimitRecord[] | undefined,
): DoctorIssue[] => {
  const issues: DoctorIssue[] = [];
  const byName = new Map(
    (records ?? [])
      .filter((record) => typeof record.name === "string")
      .map((record) => [record.name as string, record]),
  );

  AUTH_RATE_LIMIT_EXPECTATIONS.forEach((expected) => {
    const record = byName.get(expected.name);
    if (!record) {
      issues.push({
        severity: "error",
        code: "WRANGLER_RATE_LIMIT_BINDING_MISSING",
        message: `wrangler ${environmentName} rate limit binding "${expected.name}" is missing`,
      });
      return;
    }

    if (
      record.simple?.limit !== expected.limit ||
      record.simple?.period !== expected.period
    ) {
      issues.push({
        severity: "error",
        code: "WRANGLER_RATE_LIMIT_CONFIG_INVALID",
        message: `wrangler ${environmentName} rate limit binding "${expected.name}" expected ${expected.limit}/${expected.period}s`,
      });
    }

    if (!/^[1-9][0-9]*$/u.test(record.namespace_id ?? "")) {
      issues.push({
        severity: "error",
        code: "WRANGLER_RATE_LIMIT_CONFIG_INVALID",
        message: `wrangler ${environmentName} rate limit binding "${expected.name}" namespace_id must be a positive integer string unique in the Cloudflare account`,
      });
    }
  });

  const namespaceIds = AUTH_RATE_LIMIT_EXPECTATIONS.map(
    (expected) => byName.get(expected.name)?.namespace_id,
  ).filter((value): value is string => Boolean(value));
  if (new Set(namespaceIds).size !== namespaceIds.length) {
    issues.push({
      severity: "error",
      code: "WRANGLER_RATE_LIMIT_NAMESPACE_SHARED",
      message: `wrangler ${environmentName} auth rate limit bindings must use distinct namespace_id values`,
    });
  }

  return issues;
};

/**
 * Check wrangler bindings against the current config contract.
 */
const inspectWranglerConfig = (
  config: NabeCmsConfig,
  wranglerConfig?: unknown,
): DoctorIssue[] => {
  const normalized = normalizeWranglerConfig(wranglerConfig);
  if (!normalized) {
    return [
      {
        severity: "warning",
        code: "WRANGLER_CONFIG_MISSING",
        message:
          "wrangler config could not be loaded, so bindings and migrations_dir were not checked",
      },
    ];
  }

  const issues: DoctorIssue[] = [];
  const databaseBinding = "DB";
  const storageBinding = "R2";
  const assetsBinding = "ASSETS";
  const bindings = collectBindingNames(normalized);
  const rootVars = normalized.vars ?? {};
  const productionVars = normalized.env?.production?.vars ?? {};
  const usesAdminDevProxy = parseBooleanFlag(rootVars.ADMIN_DEV_PROXY, true);

  ["WORKER_ENV", "ADMIN_DEV_PROXY"].forEach((key) => {
    if (hasNonEmptyValue(rootVars, key)) return;
    issues.push({
      severity: "warning",
      code: "WRANGLER_VAR_MISSING",
      message: `wrangler root vars is missing "${key}"`,
    });
  });

  if (usesAdminDevProxy && !hasNonEmptyValue(rootVars, "ADMIN_DEV_PORT")) {
    issues.push({
      severity: "warning",
      code: "WRANGLER_VAR_MISSING",
      message: 'wrangler root vars is missing "ADMIN_DEV_PORT"',
    });
  }

  ["WORKER_ENV"].forEach((key) => {
    if (hasNonEmptyValue(productionVars, key)) return;
    issues.push({
      severity: "warning",
      code: "WRANGLER_VAR_MISSING",
      message: `wrangler production vars is missing "${key}"`,
    });
  });

  if (!bindings.assetsBindings.has(assetsBinding)) {
    issues.push({
      severity: "error",
      code: "WRANGLER_ASSETS_BINDING_MISSING",
      message: `wrangler config is missing assets binding "${assetsBinding}"`,
    });
  }
  if (
    normalized.assets?.binding === assetsBinding &&
    normalized.assets.not_found_handling !== "single-page-application"
  ) {
    issues.push({
      severity: "error",
      code: "WRANGLER_ASSETS_SPA_FALLBACK_MISSING",
      message:
        'wrangler assets must set not_found_handling to "single-page-application" so Admin deep links serve index.html',
    });
  }
  const workerFirst = normalized.assets?.run_worker_first;
  if (normalized.assets?.binding === assetsBinding && workerFirst !== true) {
    issues.push({
      severity: "error",
      code: "WRANGLER_ASSETS_WORKER_FIRST_REQUIRED",
      message:
        "wrangler assets run_worker_first must be true so API, robots.txt, and Admin routes cannot fall through to the Admin SPA",
    });
  }
  if (!bindings.d1Bindings.has(databaseBinding)) {
    issues.push({
      severity: "error",
      code: "WRANGLER_DB_BINDING_MISSING",
      message: `wrangler config is missing D1 binding "${databaseBinding}"`,
    });
  }
  if (!bindings.r2Bindings.has(storageBinding)) {
    issues.push({
      severity: "error",
      code: "WRANGLER_R2_BINDING_MISSING",
      message: `wrangler config is missing R2 binding "${storageBinding}"`,
    });
  }
  issues.push(
    ...inspectAuthRateLimitEnvironment("root", normalized.ratelimits),
  );
  if (normalized.env?.production) {
    issues.push(
      ...inspectAuthRateLimitEnvironment(
        "production",
        normalized.env.production.ratelimits,
      ),
    );
  }
  const migrationDirs = bindings.d1MigrationDirs.get(databaseBinding);
  if (
    migrationDirs &&
    !migrationDirs.has("./migrations") &&
    migrationDirs.size > 0
  ) {
    issues.push({
      severity: "warning",
      code: "WRANGLER_MIGRATIONS_DIR_UNEXPECTED",
      message: `wrangler config uses migrations_dir "${[...migrationDirs].join(", ")}" for binding "${databaseBinding}", expected "./migrations"`,
    });
  }

  return issues;
};

const inspectEnvState = (
  wranglerConfig: unknown,
  envState?: DoctorInput["envState"],
): DoctorIssue[] => {
  if (!envState) return [];

  const normalizedWrangler = normalizeWranglerConfig(wranglerConfig);
  const rootVars = normalizedWrangler?.vars ?? {};
  const betterAuthSessionsEnabled = hasNonEmptyValue(
    rootVars,
    "BETTER_AUTH_URL",
  );
  const issues: DoctorIssue[] = [];

  if (!envState.devVarsExample) {
    issues.push({
      severity: "warning",
      code: "LOCAL_DEV_VARS_TEMPLATE_MISSING",
      message:
        "`.dev.vars.example` is missing, so local secret template checks were skipped",
    });
  } else {
    const requiredTemplateKeys = [
      "JWT_SECRET",
      ...(betterAuthSessionsEnabled ? ["BETTER_AUTH_SECRET"] : []),
    ];
    requiredTemplateKeys.forEach((key) => {
      if (Object.hasOwn(envState.devVarsExample ?? {}, key)) return;
      issues.push({
        severity: "warning",
        code: "LOCAL_ENV_TEMPLATE_KEY_MISSING",
        message: `\`.dev.vars.example\` is missing "${key}"`,
      });
    });
  }

  if (!envState.devVars) {
    issues.push({
      severity: "warning",
      code: "LOCAL_DEV_VARS_FILE_MISSING",
      message:
        "`.dev.vars` is missing, so local secret checks could not verify runtime-ready values",
    });
    return issues;
  }

  const requiredLocalKeys = [
    "JWT_SECRET",
    ...(betterAuthSessionsEnabled ? ["BETTER_AUTH_SECRET"] : []),
  ];
  requiredLocalKeys.forEach((key) => {
    if (hasNonEmptyValue(envState.devVars, key)) return;
    issues.push({
      severity: "warning",
      code: "LOCAL_ENV_SECRET_MISSING",
      message: `\`.dev.vars\` is missing "${key}"`,
    });
  });

  return issues;
};

/**
 * Build a structured diagnostic report for the current project config.
 */
export const runDoctor = ({
  config,
  wranglerConfig,
  envState,
}: DoctorInput = {}): DoctorReport => {
  const resolvedConfig = config ?? {};

  const issues: DoctorIssue[] = [
    ...inspectWranglerConfig(resolvedConfig, wranglerConfig),
    ...inspectEnvState(wranglerConfig, envState),
  ];

  if (issues.length === 0) {
    issues.push({
      severity: "info",
      code: "CONFIG_OK",
      message: "No configuration issues found",
    });
  }

  const summary = issues.reduce(
    (acc, issue) => {
      if (issue.severity === "error") acc.errors += 1;
      if (issue.severity === "warning") acc.warnings += 1;
      if (issue.severity === "info") acc.infos += 1;
      return acc;
    },
    { errors: 0, warnings: 0, infos: 0 },
  );

  return {
    ok: summary.errors === 0,
    summary,
    issues,
  };
};
