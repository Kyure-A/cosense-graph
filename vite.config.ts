import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

function cookieHeaderFromEnv(value?: string) {
  if (!value) return undefined;
  if (value.includes("=") || value.includes(";")) return value;
  return `connect.sid=${value}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const cosenseCookie = cookieHeaderFromEnv(env.COSENSE_COOKIE);
  const cosenseProxy: Record<string, ProxyOptions> = {
    "/cosense-api": {
      target: "https://scrapbox.io",
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/cosense-api/, "/api"),
      configure(proxy) {
        proxy.on("proxyReq", (proxyReq) => {
          if (cosenseCookie) {
            proxyReq.setHeader("cookie", cosenseCookie);
          }
        });
      },
    },
  };

  return {
    plugins: [react()],
    server: {
      proxy: cosenseProxy,
    },
    preview: {
      proxy: cosenseProxy,
    },
  };
});
