import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.CF_PAGES ? "/" : "/community/",
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_ORIGIN || "http://localhost:3001",
        changeOrigin: true,
        secure: true,
      },
      "/ws": {
        target: (process.env.VITE_API_ORIGIN || "http://localhost:3001").replace(/^http/, "ws"),
        ws: true,
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
