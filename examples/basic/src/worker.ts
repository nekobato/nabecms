import { createApp, runLogCleanup, type Env } from "@nekobato/nabecms";
import config from "../nabecms.config";

const app = createApp({ config });

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runLogCleanup(env);
  },
};
export type { AppType } from "@nekobato/nabecms";
