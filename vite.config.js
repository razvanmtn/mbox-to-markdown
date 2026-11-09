import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs work at the project Pages path and at the local preview root.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
  },
});
