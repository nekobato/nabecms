import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { adminSettingsPageExtensions, adminSidebarPageExtensions } from "../admin-extensions";
import i18n from "../plugins/i18n";
import { syncDocumentMetadata } from "../utils/documentMetadata";

const DESIGN_MODE = import.meta.env.VITE_DESIGN_MODE === "true";

const DashboardPage = () => import("../pages/DashboardPage.vue");
const LoginPage = () => import("../pages/auth/LoginPage.vue");
const InitializePage = () => import("../pages/auth/InitializePage.vue");
const LogoutPage = () => import("../pages/auth/LogoutPage.vue");
const InviteAcceptPage = () => import("../pages/auth/InviteAcceptPage.vue");
const ModelsListPage = () => import("../pages/models/ModelsListPage.vue");
const ModelCreatePage = () => import("../pages/models/ModelCreatePage.vue");
const ModelDetailPage = () => import("../pages/models/ModelDetailPage.vue");
const ContentsListPage = () => import("../pages/contents/ContentsListPage.vue");
const ModelEntriesPage = () => import("../pages/contents/ModelEntriesPage.vue");
const EntrySheetPage = () => import("../pages/contents/EntrySheetPage.vue");
const EntryCreatePage = () => import("../pages/contents/EntryCreatePage.vue");
const EntryEditPage = () => import("../pages/contents/EntryEditPage.vue");
const LogsPage = () => import("../pages/LogsPage.vue");
const MediaListPage = () => import("../pages/media/MediaListPage.vue");
const MediaDetailPage = () => import("../pages/media/MediaDetailPage.vue");
const SettingsPage = () => import("../pages/settings/SettingsPage.vue");
const LocalesPage = () => import("../pages/settings/LocalesPage.vue");
const UsersPage = () => import("../pages/settings/UsersPage.vue");
const RolesPage = () => import("../pages/settings/RolesPage.vue");
const ApiKeysPage = () => import("../pages/settings/ApiKeysPage.vue");

/**
 * Create the admin router with built-in and host-provided extension routes.
 */
export const createAdminRouter = () =>
  createRouter({
    history: createWebHistory("/admin/"),
    routes: [
      {
        path: "/",
        name: "dashboard",
        component: DashboardPage,
      },
      { path: "/settings/email", name: "settings-email", component: () => import("../pages/settings/EmailSettingsPage.vue") },
      { path: "/auth/forgot-password", name: "forgot-password", component: () => import("../pages/auth/ForgotPasswordPage.vue") },
      { path: "/auth/reset-password", name: "reset-password", component: () => import("../pages/auth/ResetPasswordPage.vue") },
      // Authentication routes
      {
        path: "/auth/login",
        name: "login",
        component: LoginPage,
      },
      {
        path: "/auth/logout",
        name: "logout",
        component: LogoutPage,
      },
      {
        path: "/auth/invite",
        name: "invite-accept",
        component: InviteAcceptPage,
      },
      {
        path: "/auth/initialize",
        name: "initialize",
        component: InitializePage,
      },
      // Models management routes
      {
        path: "/models",
        name: "models",
        component: ModelsListPage,
      },
      // Logs
      {
        path: "/logs",
        name: "logs",
        component: LogsPage,
      },
      {
        path: "/models/create",
        name: "model-create",
        component: ModelCreatePage,
      },
      {
        path: "/models/:modelId",
        name: "model-detail",
        component: ModelDetailPage,
        props: true,
      },
      // Contents management routes
      {
        path: "/contents",
        name: "contents",
        component: ContentsListPage,
      },
      {
        path: "/contents/:modelId",
        name: "model-entries",
        component: ModelEntriesPage,
        props: true,
      },
      {
        path: "/contents/:modelId/sheet",
        name: "entry-sheet",
        component: EntrySheetPage,
        props: true,
      },
      {
        path: "/contents/:modelId/create",
        name: "entry-create",
        component: EntryCreatePage,
        props: true,
      },
      {
        path: "/contents/:modelId/:entryId",
        name: "entry-edit",
        component: EntryEditPage,
        props: true,
      },
      // Media management routes
      {
        path: "/media",
        name: "media",
        component: MediaListPage,
      },
      {
        path: "/media/:mediaId",
        name: "media-detail",
        component: MediaDetailPage,
        props: true,
      },
      // Host-owned top-level routes
      ...adminSidebarPageExtensions.map((page) => ({
        path: page.path,
        name: page.routeName,
        component: page.component as never,
      })),
      // Settings routes
      { path: "/settings/logs", name: "settings-logs", component: () => import("../pages/settings/LogManagementPage.vue") },
      { path: "/settings/export", name: "settings-export", component: () => import("../pages/settings/ExportPage.vue") },
      {
        path: "/settings",
        name: "settings",
        component: SettingsPage,
      },
      {
        path: "/settings/locales",
        name: "settings-locales",
        component: LocalesPage,
      },
      {
        path: "/settings/users",
        name: "settings-users",
        component: UsersPage,
      },
      {
        path: "/settings/roles",
        name: "settings-roles",
        component: RolesPage,
      },
      {
        path: "/settings/api-keys",
        name: "settings-api-keys",
        component: ApiKeysPage,
      },
      ...adminSettingsPageExtensions.map((page) => ({
        path: page.fullPath,
        name: page.routeName,
        component: page.component as never,
      })),
      // 404 fallback
      {
        path: "/:pathMatch(.*)*",
        redirect: "/",
      },
    ],
  });

const router = createAdminRouter();

export default router;

// Router guards for auth & bootstrap
let bootstrapped = false;
router.beforeEach(async (to) => {
  // In design mode, bypass all auth/API calls and allow navigation
  if (DESIGN_MODE) return true;

  const auth = useAuthStore();
  if (!bootstrapped) {
    await auth.loadBootstrap();
    bootstrapped = true;
    // If DB is not configured, stop navigation early to show blocking message
    if (auth.bootstrapError?.code === "DATABASE_NOT_CONFIGURED" || auth.bootstrapError?.code === "DATABASE_NOT_INITIALIZED") {
      return false;
    }
  }

  const isAuthRoute = to.path.startsWith("/auth");

  // Redirect legacy signup route to initialize
  if (to.path === "/auth/signup") {
    return { path: "/auth/initialize" };
  }

  if (to.path === "/auth/login" && auth.isAuthenticated) {
    return { path: "/" };
  }

  // For non-auth routes, ensure authenticated or try silent refresh.
  if (!isAuthRoute) {
    if (!auth.isAuthenticated) {
      const ok = await auth.refresh();
      if (!ok) {
        return { path: auth.allowSignup ? "/auth/initialize" : "/auth/login" };
      }
    }
  }
  return true;
});

router.afterEach((to, _from, failure) => {
  if (failure) return;
  syncDocumentMetadata({
    routeName: to.name,
    routeParams: to.params,
    locale: String(i18n.global.locale.value),
    t: (key) => String(i18n.global.t(key)),
  });
});
