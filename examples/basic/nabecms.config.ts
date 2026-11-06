import { defineConfig } from "@nekobato/nabecms";
import { appRuntimeMigrations } from "./src/database/runtime-migrations";

export default defineConfig({
  database: {
    migrations: {
      app: [...appRuntimeMigrations],
    },
  },
});
