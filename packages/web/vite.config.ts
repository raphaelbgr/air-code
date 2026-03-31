import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7333',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:7333',
        ws: true,
      },
      '/socket.io': {
        target: 'http://localhost:7333',
        ws: true,
      },
    },
  },
});
