/**
 * @deprecated Use ../nabecms-dev/drizzle.config.ts for migration generation.
 */
import type { Config } from "drizzle-kit";

export default {
  schema: "../nabecms-dev/src/database/schema.ts",
  out: "../nabecms-dev/migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: "",
    databaseId: "",
    token: ""
  }
} satisfies Config;
