import { z } from "zod";

/**
 * One runtime migration bundled into the host app.
 */
export type RuntimeMigration = {
  name: string;
  sql: string;
};

/**
 * Runtime migration configuration resolved by the host app.
 */
export type DatabaseMigrationsConfig = {
  /**
   * Enable request-time migrations.
   *
   * When omitted, migrations run in non-production runtimes and are disabled
   * when `WORKER_ENV` is `production`.
   */
  enabled?: boolean;
  tableName?: string;
  app?: RuntimeMigration[];
};

/**
 * Optional Admin UI configuration.
 */
export type AdminConfig = {
  devServer?: {
    enabled?: boolean;
    port?: number;
    host?: string;
  };
};

/**
 * Optional D1 database configuration.
 */
export type DatabaseConfig = {
  migrations?: DatabaseMigrationsConfig;
};

/**
 * Optional structured logging configuration for Cloudflare Workers Logs.
 */
export type ObservabilityConfig = {
  structuredLogs?: {
    enabled?: boolean;
  };
};

/**
 * Internal scheduled publishing prototype retained for source compatibility.
 *
 * @internal
 */
type ScheduledPublishingRunnerConfig = {
  type?: "manual" | "durable-object";
  binding?: string;
  instanceName?: string;
};

/**
 * Optional scheduled publishing feature configuration.
 */
type ScheduledPublishingConfig = {
  enabled?: boolean;
  runner?: ScheduledPublishingRunnerConfig;
};

/**
 * Optional publishing feature configuration.
 */
type PublishingConfig = {
  scheduled?: ScheduledPublishingConfig;
};

/**
 * Root NabeCMS configuration shape.
 */
export type NabeCmsConfig = {
  database?: DatabaseConfig;
  admin?: AdminConfig;
  observability?: ObservabilityConfig;
};

const adminSchema = z
  .object({
    devServer: z
      .object({
        enabled: z.boolean().optional(),
        port: z.number().int().positive().optional(),
        host: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

const databaseSchema = z
  .object({
    migrations: z
      .object({
        enabled: z.boolean().optional(),
        tableName: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
          .optional(),
        app: z
          .array(
            z
              .object({
                name: z.string().min(1),
                sql: z.string().min(1),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

const observabilitySchema = z
  .object({
    structuredLogs: z
      .object({
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

const configSchema = z
  .object({
    database: databaseSchema,
    admin: adminSchema,
    observability: observabilitySchema,
  })
  .strict();

/**
 * Define a NabeCMS configuration object with type inference.
 */
export const defineConfig = (config: NabeCmsConfig): NabeCmsConfig => config;

/**
 * Validate and normalize a NabeCMS configuration object.
 */
export const loadConfig = (config?: NabeCmsConfig): NabeCmsConfig => {
  const parsed = configSchema.parse(config ?? {});
  return parsed satisfies NabeCmsConfig;
};

/**
 * Determine whether scheduled publishing is enabled for this app.
 * @param config - Resolved NabeCMS config
 * @returns True when scheduled publishing routes and runner hooks are active
 */
export const isScheduledPublishingEnabled = (
  config: NabeCmsConfig | undefined,
): boolean =>
  (config as (NabeCmsConfig & { publishing?: PublishingConfig }) | undefined)
    ?.publishing?.scheduled?.enabled === true;

/**
 * Resolve scheduled publishing runner options with stable defaults.
 * @param config - Resolved NabeCMS config
 * @returns Runner configuration used by admin routes and scheduler hooks
 */
export const resolveScheduledPublishingRunner = (
  config: NabeCmsConfig | undefined,
): Required<ScheduledPublishingRunnerConfig> => ({
  type:
    (config as (NabeCmsConfig & { publishing?: PublishingConfig }) | undefined)
      ?.publishing?.scheduled?.runner?.type ?? "manual",
  binding:
    (config as (NabeCmsConfig & { publishing?: PublishingConfig }) | undefined)
      ?.publishing?.scheduled?.runner?.binding ?? "PUBLICATION_SCHEDULER",
  instanceName:
    (config as (NabeCmsConfig & { publishing?: PublishingConfig }) | undefined)
      ?.publishing?.scheduled?.runner?.instanceName ?? "default",
});
