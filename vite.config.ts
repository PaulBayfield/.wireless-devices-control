import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  // The 3D viewer (three.js) is one big chunk, only loaded for a device with a 3D model.
  build: { chunkSizeWarningLimit: 1100 },
  // Tauri reads the dev server and wants to see its own errors.
  clearScreen: false,
  server: {
    port: 1470,
    strictPort: true,
    // The API server (npm run server) during development.
    proxy: {
      "/api": "http://localhost:8830",
    },
    watch: {
      ignored: ["**/server/**", "**/src-tauri/**", "**/agent/**"],
    },
  },
});
