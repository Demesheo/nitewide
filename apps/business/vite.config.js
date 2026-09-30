import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ['@nitewide/pricing'] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "charts", test: /node_modules[\\/]recharts[\\/]/ },
            { name: "primitives", test: /node_modules[\\/](?:@radix-ui|radix-ui)[\\/]/ },
          ],
        },
      },
    },
  },
  server: { strictPort: true, proxy: { "/api": process.env.NITEWIDE_API_PROXY || "http://localhost:4000" } },
});
