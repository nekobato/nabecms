/**
 * Drizzle config for generating migrations from the internal dev app schema.
 */
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/database/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
