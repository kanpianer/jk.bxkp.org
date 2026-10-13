/**
 * scripts/cms-server.mjs
 *
 * 家宽导航 (jiakuan.link) 本地统一服务 (端口: 404)
 * 启动方式：
 *   npm run cms
 * 或
 *   node scripts/cms-server.mjs
 *
 * 统一访问方式：
 *   - 前端网站: http://localhost:404/
 *   - 后端 CMS: http://localhost:404/Donttouchmyshit
 *
 * 特性：
 * 1. 端口统一为 404，单服务同时承载前台展示、后台内容管理与短链路由；
 * 2. 针对 Linux 系统 1024 以下特权端口限制，遇权限不足时输出友好赋权指引并平滑回退至 4040；
 * 3. 原生 Node.js 实现，零额外第三方包依赖；
 * 4. 完整的 MIME 类型识别、短链动态 302 重定向与 API 接口支持。
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import {
  readAllData,
  saveAllData,
  saveGuideArticle,
  deleteGuideArticle,
  saveUploadedIcon,
  deleteUploadedIcon,
  generateGuideArticleHtml,
  checkLinkHealth,
  createBackup,
  listBackups,
  restoreBackup,
  gitCommitAndPush,
  ROOT_DIR,
  MAP_FILE,
  INDEX_HTML_FILE
} from './cms-service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRIMARY_PORT = 404;
const FALLBACK_PORT = 4040;
const ADMIN_HTML_FILE = path.resolve(ROOT_DIR, 'public/Donttouchmyshit/index.html');
const ROOT_404_FILE = path.resolve(ROOT_DIR, '404.html');

/**
 * MIME 类型字典
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 读取 POST JSON 请求体
 */
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('请求体超出大小限制 (50MB)'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('JSON 格式解析错误'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 跨域安全响应辅助函数
 */
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

/**
 * 静态资源处理
 */
function serveStaticFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (fs.existsSync(ROOT_404_FILE)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(ROOT_404_FILE).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * 主请求分发处理器
 */
async function handleRequest(req, res) {
  // 处理跨域预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. API 路由分发
  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        return sendJson(res, 200, {
          status: 'ok',
          mode: 'local',
          rootDir: ROOT_DIR,
          port: req.socket.localPort,
          time: new Date().toISOString()
        });
      }

      if (pathname === '/api/data' && req.method === 'GET') {
        const data = readAllData();
        return sendJson(res, 200, { success: true, data });
      }

      if (pathname === '/api/save' && req.method === 'POST') {
        const payload = await parseRequestBody(req);
        const result = await saveAllData(payload);
        return sendJson(res, 200, { success: true, result });
      }

      if (pathname === '/api/save-guide' && req.method === 'POST') {
        const payload = await parseRequestBody(req);
        const result = saveGuideArticle(payload);
        return sendJson(res, 200, { success: true, result });
      }

      if (pathname === '/api/delete-guide' && req.method === 'POST') {
        const { filename } = await parseRequestBody(req);
        if (!filename) {
          return sendJson(res, 400, { error: '缺少 filename' });
        }
        const result = deleteGuideArticle(filename);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/upload-icon' && req.method === 'POST') {
        const { filename, base64Data } = await parseRequestBody(req);
        if (!filename || !base64Data) {
          return sendJson(res, 400, { error: '缺少 filename 或 base64Data' });
        }
        const result = saveUploadedIcon(filename, base64Data);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/delete-icon' && req.method === 'POST') {
        const { filename } = await parseRequestBody(req);
        if (!filename) {
          return sendJson(res, 400, { error: '缺少 filename' });
        }
        const result = deleteUploadedIcon(filename);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/check-links' && req.method === 'POST') {
        const { urls } = await parseRequestBody(req);
        const results = await checkLinkHealth(urls || []);
        return sendJson(res, 200, { success: true, results });
      }

      if (pathname === '/api/backups' && req.method === 'GET') {
        const backups = listBackups();
        return sendJson(res, 200, { success: true, backups });
      }

      if (pathname === '/api/create-backup' && req.method === 'POST') {
        const { note } = await parseRequestBody(req);
        const meta = createBackup(note || 'manual');
        return sendJson(res, 200, { success: true, meta });
      }

      if (pathname === '/api/restore-backup' && req.method === 'POST') {
        const { backupId } = await parseRequestBody(req);
        const result = restoreBackup(backupId);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/git-push' && req.method === 'POST') {
        const { message } = await parseRequestBody(req);
        const result = await gitCommitAndPush(message);
        return sendJson(res, 200, { success: true, result });
      }

      return sendJson(res, 404, { error: `未找到 API 端点: ${pathname}` });
    } catch (err) {
      console.error('[API Error]', err);
      return sendJson(res, 500, { error: err.message || '服务器内部异常' });
    }
  }

  // 2. 封禁旧 /admin 路径，彻底防扫描嗅探 (直接返回 404)
  const lowerPath = pathname.toLowerCase();
  if (lowerPath === '/admin' || lowerPath.startsWith('/admin/')) {
    if (fs.existsSync(ROOT_404_FILE)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(ROOT_404_FILE).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 3. 后端 CMS 访问: /Donttouchmyshit 与 /public/Donttouchmyshit/ (支持大小写自适应，防扫描)
  if (
    lowerPath === '/donttouchmyshit' ||
    lowerPath === '/donttouchmyshit/' ||
    lowerPath === '/donttouchmyshit/index.html'
  ) {
    if (pathname !== '/Donttouchmyshit/') {
      res.writeHead(301, { Location: '/Donttouchmyshit/' });
      res.end();
      return;
    }
    if (fs.existsSync(ADMIN_HTML_FILE)) {
      return serveStaticFile(res, ADMIN_HTML_FILE);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('CMS 前端文件未就绪，请确保 public/Donttouchmyshit/index.html 存在');
      return;
    }
  }

  if (
    lowerPath === '/public/donttouchmyshit' ||
    lowerPath === '/public/donttouchmyshit/' ||
    lowerPath === '/public/donttouchmyshit/index.html'
  ) {
    if (pathname !== '/public/Donttouchmyshit/') {
      res.writeHead(301, { Location: '/public/Donttouchmyshit/' });
      res.end();
      return;
    }
    if (fs.existsSync(ADMIN_HTML_FILE)) {
      return serveStaticFile(res, ADMIN_HTML_FILE);
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('CMS 前端文件未就绪，请确保 public/Donttouchmyshit/index.html 存在');
      return;
    }
  }

  // 3. 前端导航主页访问: / 或 /index.html
  if (pathname === '/' || pathname === '/index.html') {
    if (fs.existsSync(INDEX_HTML_FILE)) {
      return serveStaticFile(res, INDEX_HTML_FILE);
    }
  }

  // 4. 短链接动态跳转支持 (如 /rancho, /mesl, /old, /vps 等)
  const cleanSlug = pathname.replace(/^\/+|\/+$/g, '').toLowerCase().split('?')[0];
  if (cleanSlug && !cleanSlug.includes('.')) {
    try {
      if (fs.existsSync(MAP_FILE)) {
        const linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
        if (linksMap[cleanSlug] && linksMap[cleanSlug].target) {
          let target = linksMap[cleanSlug].target;
          if (target.startsWith('https://jiakuan.link/#') || target === 'https://jiakuan.link/' || target === 'https://jiakuan.link') {
            target = target.replace('https://jiakuan.link', '') || '/';
          }
          res.writeHead(302, { Location: target });
          res.end();
          return;
        }
      }
    } catch (e) {}
  }

  // 5. 静态资源托管（css/*, js/*, images/*, guides/*, sw.js 等）
  const sanitizedPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const localFilePath = path.resolve(ROOT_DIR, '.' + sanitizedPath);

  // 安全检查：防止目录穿越攻击
  if (!localFilePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
    return serveStaticFile(res, localFilePath);
  }

  // 兜底返回 404
  if (fs.existsSync(ROOT_404_FILE)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(ROOT_404_FILE).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

/**
 * 启动统一本地服务
 */
function startServer(port = PRIMARY_PORT) {
  const server = http.createServer(handleRequest);

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.warn(`\n⚠️  [权限提示] 端口 ${port} 在 Linux 系统中属于特权端口 (< 1024)，普通非 root 用户无权直接监听。`);
      console.warn(`💡 如需直接使用 404 端口，可通过以下方式之一授权：`);
      console.warn(`   方案 1 (推荐，直接使用 sudo): sudo npm run cms`);
      console.warn(`   方案 2 (免密码一次性授权 Node): sudo setcap 'cap_net_bind_service=+ep' $(which node)`);
      console.warn(`   方案 3 (修改系统未授权端口下限): sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80\n`);
      if (port === PRIMARY_PORT) {
        console.log(`🔄 正在自动回退至备用免权限端口 ${FALLBACK_PORT}...`);
        startServer(FALLBACK_PORT);
        return;
      }
    }
    if (err.code === 'EADDRINUSE') {
      console.log(`[CMS] 端口 ${port} 已被占用，尝试探测下一个端口 ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    console.error('[CMS] 启动异常:', err);
  });

  server.listen(port, '0.0.0.0', () => {
    const isPrimary = (port === PRIMARY_PORT);
    console.log('\n======================================================');
    console.log(`🎉 家宽导航本地统一服务已成功启动！ (统一端口: ${port})`);
    console.log(`🌐 前端站点访问: \x1b[32mhttp://localhost:${port}/\x1b[0m`);
    console.log(`🛠️ 后端 CMS 访问: \x1b[36mhttp://localhost:${port}/Donttouchmyshit\x1b[0m`);
    if (!isPrimary) {
      console.log(`\nℹ️  提示: 当前由于系统权限限制暂回退至端口 ${port}。`);
      console.log(`   执行 sudo npm run cms 即可直接启用 404 端口！`);
    }
    console.log('======================================================\n');

    // 支持 --open 参数自动打开浏览器
    if (process.argv.includes('--open')) {
      const openUrl = `http://localhost:${port}/Donttouchmyshit`;
      const openCmd = process.platform === 'win32' ? `start ${openUrl}` : (process.platform === 'darwin' ? `open ${openUrl}` : `xdg-open ${openUrl}`);
      exec(openCmd, () => {});
    }
  });
}

// 仅在直接执行本文件时启动服务
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
