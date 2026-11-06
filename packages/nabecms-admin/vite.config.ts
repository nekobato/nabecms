import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import vueDevTools from "vite-plugin-vue-devtools";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version?: string;
};
const nabeCmsVersion = packageJson.version ?? "0.0.0";
const thirdPartyNoticeFile = "THIRD_PARTY_NOTICES.txt";

/**
 * Groups large third-party modules into stable vendor chunks.
 */
const createManualChunk = (id: string): string | undefined => {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  const modulePath = id.replaceAll("\\", "/");
  if (
    modulePath.includes("/node_modules/@vue/") ||
    modulePath.includes("/node_modules/vue/") ||
    modulePath.includes("/node_modules/vue-router/") ||
    modulePath.includes("/node_modules/vue-i18n/") ||
    modulePath.includes("/node_modules/pinia/")
  ) {
    return "vendor-vue";
  }

  if (modulePath.includes("/node_modules/@iconify/")) {
    return "vendor-icons";
  }

  if (modulePath.includes("/node_modules/element-plus/") || modulePath.includes("/node_modules/@element-plus/")) {
    return "vendor-element-plus";
  }

  if (modulePath.includes("/node_modules/vee-validate/") || modulePath.includes("/node_modules/@vee-validate/")) {
    return "vendor-validation";
  }

  if (modulePath.includes("/node_modules/@codemirror/") || modulePath.includes("/node_modules/@lezer/") || modulePath.includes("/node_modules/codemirror/")) {
    return "vendor-codemirror";
  }

  if (modulePath.includes("/node_modules/@tiptap/") || modulePath.includes("/node_modules/prosemirror-")) {
    return "vendor-editor";
  }

  return undefined;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueJsx(), vueDevTools()],
  define: {
    "import.meta.env.VITE_NABECMS_VERSION": JSON.stringify(nabeCmsVersion),
  },
  // Serve app under /admin/ both in dev and build
  base: "/admin/",
  server: {
    port: 2525,
    fs: {
      allow: [fileURLToPath(new URL("../..", import.meta.url))],
    },
    proxy: {
      // Proxy API calls during local dev to Wrangler on 8787
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        // keep path as-is
        rewrite: (path) => path,
        // forward cookies for auth (Better Auth refresh/login)
        configure: () => {
          // no-op; placeholder to emphasize cookie forwarding via http-proxy
        },
      },
    },
  },
  build: {
    license: {
      fileName: ".vite/third-party-licenses.json",
    },
    rolldownOptions: {
      output: {
        manualChunks: createManualChunk,
        postBanner: `/*! Third-party notices: /admin/${thirdPartyNoticeFile} */`,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@app-admin-extensions": fileURLToPath(new URL("../dev/src/admin/extensions.ts", import.meta.url)),
    },
  },
});
