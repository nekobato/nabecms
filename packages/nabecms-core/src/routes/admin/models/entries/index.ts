import { Hono } from "hono";
import type { AppContext } from "../../../../types";
import readRoutes from "./read-routes";
import writeRoutes from "./write-routes";

const app = new Hono<AppContext>()
  .route("/", readRoutes)
  .route("/", writeRoutes);

export default app;
