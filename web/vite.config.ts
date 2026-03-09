import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { honoMiddlewarePlugin } from "./src/vite-hono-plugin.js";
import { getViteBaseConfig } from "./src/vite-base-config.js";
import { buildWebServerConfigFromEnv } from "./src/web-server-config.js";

// https://vitejs.dev/config/
export default defineConfig({
  ...getViteBaseConfig(__dirname),
  plugins: [react(), honoMiddlewarePlugin(buildWebServerConfigFromEnv())],
  server: {
    host: true,
  },
});
