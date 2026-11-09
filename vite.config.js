import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

function staticIndexes() {
  return {
    name: 'static-indexes',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = decodeURIComponent((request.url || '/').split('?')[0]);
        if (url === '/' || path.extname(url)) return next();
        const directory = url.endsWith('/') ? url : `${url}/`;
        const file = path.join(server.config.publicDir, directory.slice(1), 'index.html');
        if (!existsSync(file)) return next();
        const query = (request.url || '').includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
        request.url = `${directory}index.html${query}`;
        next();
      });
    },
  };
}

export default defineConfig({
  // The guides are ordinary HTML files. Do not fall back to the app page.
  appType: 'mpa',
  base: './',
  plugins: [staticIndexes()],
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
  },
});
