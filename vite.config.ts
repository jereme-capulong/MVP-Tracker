import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "renderer",
  envDir: "..",
  // Required for Electron file:// loading in production builds.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
  },
});
