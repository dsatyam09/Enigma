import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const defaultAllowedOrigins = ["http://localhost:5173", "http://localhost:3000"];

function parseAllowedOrigins(rawOrigins?: string) {
  if (!rawOrigins) {
    return defaultAllowedOrigins;
  }

  const parsedOrigins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return parsedOrigins.length > 0 ? parsedOrigins : defaultAllowedOrigins;
}

function getAllowedHosts(origins: string[]) {
  return Array.from(
    new Set(
      origins.flatMap((origin) => {
        try {
          return [new URL(origin).hostname];
        } catch {
          return [];
        }
      }),
    ),
  );
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const allowedOrigins = parseAllowedOrigins(env.APP_ALLOWED_ORIGINS);

  const backendUrl = env.VITE_API_URL || "http://localhost:8000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      allowedHosts: getAllowedHosts(allowedOrigins),
      proxy: {
        // Route all API traffic through /api to avoid collisions with SPA routes
        // like /auth and /leaderboard.
        "/api": {
          target: backendUrl,
          changeOrigin: true,
          rewrite: (apiPath) => apiPath.replace(/^\/api/, ""),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
