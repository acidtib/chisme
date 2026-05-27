import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Stage 2 stub config. The dev server proxies /api to @chisme/server (port 4123).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4124,
    proxy: {
      "/api": "http://localhost:4123",
    },
  },
});
