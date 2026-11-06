import { defineConfig } from "@nekobato/nabecms-core";
import { appRuntimeMigrations } from "./src/database/runtime-migrations";

export default defineConfig({
  database: {
    migrations: {
      app: [...appRuntimeMigrations],
    },
  },
  admin: {
    devServer: {
      host: "localhost",
      port: 2525,
    },
  },
});
