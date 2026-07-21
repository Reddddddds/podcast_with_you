﻿﻿import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// 强制给 .js / .ts / .tsx / .mjs 响应设 charset=utf-8,
// 避免 chromium-headless-shell 在中文 locale 下按 GBK 解码中文字面量。
function charsetPlugin(): Plugin {
  return {
    name: "pwy-charset",
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const set = res.setHeader.bind(res);
        res.setHeader = (name: string, value: any) => {
          if (name.toLowerCase() === "content-type" && typeof value === "string") {
            if (!/charset=/i.test(value)) {
              value = value + "; charset=utf-8";
            }
          }
          return set(name, value);
        };
        next();
      });
    },
  };
}

export default defineConfig({
  // 相对路径 base:产物对子路径(/repo-name/、自定义域、根域)都通用。
  base: "./",
  plugins: [
    charsetPlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Podcast With You",
        short_name: "PodcastWithYou",
        description: "异地同步听播客,任一方操作即同步",
        theme_color: "#1f2937",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ],
  server: { host: "0.0.0.0", port: 5173 }
});