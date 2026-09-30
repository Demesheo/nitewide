import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ['@nitewide/pricing'] },
  build: { commonjsOptions: { include: [/node_modules/, /apps\/pricing/] } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": process.env.NITEWIDE_API_PROXY || "http://localhost:4000" } },
});
