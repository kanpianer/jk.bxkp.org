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
              let target = map[slug].target;
              if (target.startsWith('https://jiakuan.link/#') || target === 'https://jiakuan.link/' || target === 'https://jiakuan.link') {
                target = target.replace('https://jiakuan.link', '') || '/';
              }
              res.writeHead(302, { Location: target });
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
              let target = map[slug].target;
              if (target.startsWith('https://jiakuan.link/#') || target === 'https://jiakuan.link/' || target === 'https://jiakuan.link') {
                target = target.replace('https://jiakuan.link', '') || '/';
              }
              res.writeHead(302, { Location: target });
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

function syncJsPlugin() {
  return {
    name: 'sync-js-to-public',
    buildStart() {
      try {
        const srcDir = resolve(__dirname, 'js');
        const destDir = resolve(__dirname, 'public/js');
        if (fs.existsSync(srcDir)) {
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          for (const file of fs.readdirSync(srcDir)) {
            fs.copyFileSync(resolve(srcDir, file), resolve(destDir, file));
          }
        }
        const swSrc = resolve(__dirname, 'sw.js');
        const swDest = resolve(__dirname, 'public/sw.js');
        if (fs.existsSync(swSrc)) {
          fs.copyFileSync(swSrc, swDest);
        }
      } catch (e) {}
    }
  };
}

export default defineConfig({
  plugins: [shortlinkPlugin(), syncJsPlugin()],
  build: {
    assetsInlineLimit: 0,
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

