import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// If deploying to GitHub Pages at https://<username>.github.io/impi-cctv-register/
// keep base as "/impi-cctv-register/". If you deploy to a custom domain or the
// root of a Pages site, change base to "/".
export default defineConfig({
  base: "/impi-cctv-register/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"],
      manifest: {
        name: "IMPI CCTV IP & Diagram Register",
        short_name: "IMPI CCTV",
        description: "Site CCTV IP address and diagram register for IMPI Protection Agency",
        theme_color: "#101A29",
        background_color: "#101A29",
        display: "standalone",
        start_url: "/impi-cctv-register/",
        scope: "/impi-cctv-register/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // Cache Supabase REST/storage responses so the last-loaded data
        // is available offline, and refresh them in the background when online.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "supabase-cache",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
