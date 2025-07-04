import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import fs from "fs";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    https: process.env.INSPECTOR_SSL_CERT_PATH && process.env.INSPECTOR_SSL_KEY_PATH ? {
      key: fs.readFileSync(process.env.INSPECTOR_SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.INSPECTOR_SSL_CERT_PATH)
    } : false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
