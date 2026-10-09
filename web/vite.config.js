import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/hotspots': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/forecast': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/meta': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/eval': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/agent': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
