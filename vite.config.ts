import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  publicDir: "assets",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    sourcemap: true,
  },
});
