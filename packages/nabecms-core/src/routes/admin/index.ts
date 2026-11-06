import emailSettingsRoute from "./email-settings";
import passwordResetRoute from "./auth/password-reset";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import type { AppContext } from "../../types";
import adminAuthInitializeRoute from "./auth/initialize";
import adminAuthLoginRoute from "./auth/login";
import adminAuthLogoutRoute from "./auth/logout";
import adminAuthRefreshRoute from "./auth/refresh";
import adminAuthMeRoute from "./auth/me";
import adminAuthSessionTokenRoute from "./auth/session-token";
import adminSystemBootstrapRoute from "./system/bootstrap";
import adminModelsRoute from "./models";
import adminModelFieldsRoute from "./models/fields";
import adminModelEntriesRoute from "./models/entries";
import adminMediaRoute from "./media";
import adminLocalesRoute from "./locales";
import adminRolesRoute from "./roles";
import adminUsersRoute from "./users";
import adminUserPreferencesRoute from "./user-preferences";
import adminEntryReferencesRoute from "./entry-references";
import adminMediaReferencesRoute from "./media-references";
import adminApiKeysRoute from "./api-keys";
import adminDashboardRoute from "./dashboard";
import adminLogsRoute from "./logs";
import adminEntryReverseReferencesRoute from "./entry-reverse-references";
import adminInvitesRoute from "./auth/invites";
import adminMediaSettingsRoute from "./media-settings";
import adminMediaVariantsRoute from "./media-variants";
import adminLogManagementRoute from "./log-management";
import adminExportRoute from "./export";

const authCsrf = csrf();

const adminApp = new Hono<AppContext>()
  .use("/api/admin/auth/*", async (c, next) => {
    // CLI clients do not send browser-origin metadata. Proxies must preserve it.
    if (!c.req.header("Origin") && !c.req.header("Sec-Fetch-Site")) {
      return next();
    }
    return authCsrf(c, next);
  })
  .route("/", adminAuthInitializeRoute)
  .route("/", adminAuthLoginRoute)
  .route("/", adminAuthLogoutRoute)
  .route("/", adminAuthRefreshRoute)
  .route("/", adminAuthMeRoute)
  .route("/", adminAuthSessionTokenRoute)
  .route("/", adminSystemBootstrapRoute)
  .route("/", adminModelsRoute)
  .route("/", adminModelFieldsRoute)
  .route("/", adminModelEntriesRoute)
  .route("/", adminMediaRoute)
  .route("/", adminLocalesRoute)
  .route("/", adminRolesRoute)
  .route("/", adminUsersRoute)
  .route("/", adminUserPreferencesRoute)
  .route("/", adminEntryReferencesRoute)
  .route("/", adminEntryReverseReferencesRoute)
  .route("/", adminMediaReferencesRoute)
  .route("/", adminApiKeysRoute)
  .route("/", adminInvitesRoute)
  .route("/", emailSettingsRoute)
  .route("/", passwordResetRoute)
  .route("/", adminMediaSettingsRoute)
  .route("/", adminMediaVariantsRoute)
  .route("/", adminDashboardRoute)
  .route("/", adminLogsRoute)
  .route("/", adminLogManagementRoute)
  .route("/", adminExportRoute);

export default adminApp;
export type AdminAppType = typeof adminApp;
