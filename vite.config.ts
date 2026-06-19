import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.svg",
        "icons/textile-icon.svg",
        "icons/textile-maskable.svg",
      ],
      manifest: {
        name: "Textile 汉化协作工具",
        short_name: "Textile",
        description: "本地优先的汉化项目协作工具",
        lang: "zh-CN",
        theme_color: "#2563eb",
        background_color: "#f6f7f9",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icons/textile-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icons/textile-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
    }),
  ],
});
