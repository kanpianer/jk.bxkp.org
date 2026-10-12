import { resolve } from 'path';
import fs from 'fs';
import net from 'net';
import { defineConfig } from 'vite';
import {
  readAllData,
  saveAllData,
  saveGuideArticle,
  saveUploadedIcon,
  checkLinkHealth,
  createBackup,
  listBackups,
  restoreBackup,
  gitCommitAndPush,
  ROOT_DIR
} from './scripts/cms-service.mjs';

function canBindPort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function cmsApiPlugin() {
  return {
    name: 'cms-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;
        // 封禁旧 /admin 路径，彻底防扫描嗅探 (直接返回 404)
        const lowerPath = pathname.toLowerCase();
        if (lowerPath === '/admin' || lowerPath.startsWith('/admin/')) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }

        // 处理 /Donttouchmyshit 与 /public/Donttouchmyshit 访问规范化重定向
        if (lowerPath === '/donttouchmyshit') {
          res.writeHead(301, { Location: '/Donttouchmyshit/' });
          res.end();
          return;
        }
        if (lowerPath === '/public/donttouchmyshit') {
          res.writeHead(301, { Location: '/public/Donttouchmyshit/' });
          res.end();
          return;
        }

        if (pathname.startsWith('/api/')) {
          try {
            if (pathname === '/api/status' && req.method === 'GET') {
              return sendJson(res, 200, { status: 'ok', mode: 'vite-dev', time: new Date().toISOString() });
            }
            if (pathname === '/api/data' && req.method === 'GET') {
              return sendJson(res, 200, { success: true, data: readAllData() });
            }
            if (pathname === '/api/save' && req.method === 'POST') {
              const body = await parseBody(req);
              return sendJson(res, 200, { success: true, result: await saveAllData(body) });
            }
            if (pathname === '/api/save-guide' && req.method === 'POST') {
              const body = await parseBody(req);
              return sendJson(res, 200, { success: true, result: saveGuideArticle(body) });
            }
            if (pathname === '/api/upload-icon' && req.method === 'POST') {
              const { filename, base64Data } = await parseBody(req);
              return sendJson(res, 200, saveUploadedIcon(filename, base64Data));
            }
            if (pathname === '/api/check-links' && req.method === 'POST') {
              const { urls } = await parseBody(req);
              return sendJson(res, 200, { success: true, results: await checkLinkHealth(urls || []) });
            }
            if (pathname === '/api/backups' && req.method === 'GET') {
              return sendJson(res, 200, { success: true, backups: listBackups() });
            }
            if (pathname === '/api/create-backup' && req.method === 'POST') {
              const { note } = await parseBody(req);
              return sendJson(res, 200, { success: true, meta: createBackup(note || 'manual') });
            }
            if (pathname === '/api/restore-backup' && req.method === 'POST') {
              const { backupId } = await parseBody(req);
              return sendJson(res, 200, restoreBackup(backupId));
            }
            if (pathname === '/api/git-push' && req.method === 'POST') {
              const { message } = await parseBody(req);
              return sendJson(res, 200, { success: true, result: await gitCommitAndPush(message) });
            }
            return sendJson(res, 404, { error: 'Not found' });
          } catch (err) {
            return sendJson(res, 500, { error: err.message });
          }
        }
        next();
      });
    }
  };
}

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

export default defineConfig(async ({ command }) => {
  let port = 404;

  if (command === 'serve') {
    const canUse404 = await canBindPort(404);
    port = canUse404 ? 404 : 4040;

    if (!canUse404) {
      console.log('\n\x1b[33m⚠️  [权限提示] Linux 限制 1024 以下端口为特权端口，当前普通用户无权直接监听 404 端口。\x1b[0m');
      console.log('\x1b[36m💡 若需直接启用 404 端口，请执行一次以下授权命令（推荐）：\x1b[0m');
      console.log('   \x1b[32msudo setcap \'cap_net_bind_service=+ep\' $(which node)\x1b[0m');
      console.log('   或使用管理员身份运行: \x1b[32msudo npm run dev\x1b[0m');
      console.log(`\x1b[35m🔄 正在自动回退至端口 ${port}（前端: http://localhost:${port} ，CMS: http://localhost:${port}/Donttouchmyshit）\x1b[0m\n`);
    }
  }

  return {
    plugins: [cmsApiPlugin(), shortlinkPlugin(), syncJsPlugin()],
    server: {
      port,
      host: true
    },
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
  };
});
