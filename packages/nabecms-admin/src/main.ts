import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "./App.vue";
import router from "./router";
import { applyAdminThemeTokens } from "./admin-extensions";
import registerElementPlus from "./plugins/element-plus";
import i18n from "./plugins/i18n";
import setupValidation, { setValidationLocale } from "./plugins/validation";
import { syncDocumentMetadata } from "./utils/documentMetadata";
import { setUnauthorizedHandler } from "./utils/http";
import { watch } from "vue";
import "./assets/styles/main.css";

const app = createApp(App);

if (typeof document !== "undefined") {
  applyAdminThemeTokens(document.documentElement.style);
}

app.use(createPinia());
app.use(router);
app.use(i18n);
registerElementPlus(app);

setUnauthorizedHandler(() => {
  const currentPath = router.currentRoute.value.path;
  if (!currentPath.startsWith("/auth")) {
    void router.push("/auth/login");
  }
});

// VeeValidate rules registration
setupValidation();
// Sync VeeValidate locale with Vue I18n
setValidationLocale(i18n.global.locale.value as string);
const syncHead = () => {
  syncDocumentMetadata({
    routeName: router.currentRoute.value.name,
    routeParams: router.currentRoute.value.params,
    locale: String(i18n.global.locale.value),
    t: (key) => String(i18n.global.t(key)),
  });
};

watch(i18n.global.locale, (loc) => {
  setValidationLocale(loc as string);
  syncHead();
});

void router.isReady().then(() => {
  syncHead();
  app.mount("#app");
});
