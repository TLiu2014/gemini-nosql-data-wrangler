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
