import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4000' } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/]recharts[\\/]/ },
            { name: 'primitives', test: /node_modules[\\/](?:@radix-ui|radix-ui)[\\/]/ },
          ],
        },
      },
    },
  },
});
