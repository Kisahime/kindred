import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // React in its own chunk keeps the app bundle under Vite's 500 kB warning
  build: { rollupOptions: { output: { manualChunks: { react: ["react", "react-dom"] } } } },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
});