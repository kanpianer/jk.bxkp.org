import { resolve } from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';

function shortlinkPlugin() {
  return {
    name: 'shortlink-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const mapPath = resolve(__dirname, 'links-map.json');
          if (fs.existsSync(mapPath)) {
            const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            const slug = req.url ? req.url.replace(/^\/+|\/+$/g, '').split('?')[0].toLowerCase() : '';
            if (slug && map[slug] && map[slug].target) {
              res.writeHead(302, { Location: map[slug].target });
              res.end();
              return;
            }
          }
        } catch (e) {}
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const mapPath = resolve(__dirname, 'links-map.json');
          if (fs.existsSync(mapPath)) {
            const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
            const slug = req.url ? req.url.replace(/^\/+|\/+$/g, '').split('?')[0].toLowerCase() : '';
            if (slug && map[slug] && map[slug].target) {
              res.writeHead(302, { Location: map[slug].target });
              res.end();
              return;
            }
          }
        } catch (e) {}
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [shortlinkPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dualIsp: resolve(__dirname, 'guides/dual-isp-residential-ip.html'),
        ipFraud: resolve(__dirname, 'guides/ip-fraud-check.html'),
        crossBorder: resolve(__dirname, 'guides/cross-border-ecommerce-setup.html'),
      },
    },
  },
});

