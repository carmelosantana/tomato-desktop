import { defineConfig } from "vite";
import { resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// @ts-expect-error __dirname is a nodejs global (CJS interop under tsconfig moduleResolution)
const root = typeof __dirname !== "undefined" ? __dirname : ".";

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Multi-page build: the hidden main window (index.html) plus the webview
  // windows opened at runtime (grace toast + break card boundary windows, and
  // the stats window). Each needs its own HTML entry so Vite bundles its module
  // and emits it under dist/.
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        "grace-toast": resolve(root, "src/grace-toast.html"),
        "break-card": resolve(root, "src/break-card.html"),
        stats: resolve(root, "src/stats.html"),
        settings: resolve(root, "src/settings.html"),
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
