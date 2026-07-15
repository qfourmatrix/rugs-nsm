import { timingSafeEqual } from "node:crypto";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

function isProtectedShareHost(host: string | undefined) {
  return host?.endsWith(".trycloudflare.com") === true;
}

function matchesBasicAuth(header: string | undefined, username: string, password: string) {
  if (!header?.startsWith("Basic ")) return false;

  try {
    const actual = Buffer.from(header.slice(6), "base64");
    const expected = Buffer.from(`${username}:${password}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const shareUsername = env.SHARE_USERNAME;
  const sharePassword = env.SHARE_PASSWORD;

  return {
    plugins: [
      react(),
      {
        name: "remote-share-auth",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const requestHost = req.headers.host?.split(":", 1)[0];
            if (!isProtectedShareHost(requestHost)) return next();

            if (shareUsername && sharePassword && matchesBasicAuth(req.headers.authorization, shareUsername, sharePassword)) {
              return next();
            }

            res.statusCode = shareUsername && sharePassword ? 401 : 503;
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            if (res.statusCode === 401) {
              res.setHeader("WWW-Authenticate", 'Basic realm="RUGS NSM", charset="UTF-8"');
            }
            res.end(res.statusCode === 401 ? "Authentication required." : "Remote sharing is not configured.");
          });
        }
      }
    ],
    build: {
      outDir: "../artifacts/dist",
      emptyOutDir: true
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts: [".trycloudflare.com"],
      proxy: {
        "/api": "http://127.0.0.1:8787"
      }
    },
    preview: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts: [".trycloudflare.com"],
      proxy: {
        "/api": "http://127.0.0.1:8787"
      }
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"]
    }
  };
});
