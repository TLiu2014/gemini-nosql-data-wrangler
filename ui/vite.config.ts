import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Local dev should land directly on the workspace, skipping the
    // marketing landing page. Browser the user opens via npm run dev will
    // jump straight to /app; navigating to / still serves the landing.
    open: "/app",
    proxy: {
      "/ws": { target: "http://localhost:8080", ws: true },
      "/health": { target: "http://localhost:8080" },
      "/api": { target: "http://localhost:8080" },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: "http://localhost:8080", ws: true },
      "/health": { target: "http://localhost:8080" },
      "/api": { target: "http://localhost:8080" },
    },
  },
});
