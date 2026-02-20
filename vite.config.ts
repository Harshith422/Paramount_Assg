import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Development proxy configuration.
 * The frontend calls /api/* and connects to /ws/tasks/* at the same origin.
 * Vite rewrites those paths to the backend running on port 8002.
 * /api/tasks  →  http://localhost:8002/tasks      (REST)
 * /ws/tasks/* →  ws://localhost:8002/ws/tasks/*   (WebSocket)
 * The `/api` prefix exists only in dev; in production the same
 * reverse-proxy (nginx / Cloud Run) would handle the routing.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: "ws://localhost:8002",
        ws: true,
      },
    },
  },
});