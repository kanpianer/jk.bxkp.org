/**
 * scripts/generate-links.js
 *
 * 自动化短链接生成与跳转跳板构建工具
 * 功能：
 * 1. 扫描 index.html 中的推荐卡片，维护 links-map.json 单一真相源；
 * 2. 自动为未分配短链的卡片分配唯一的 5 位小写英文字母后缀（如 dsiug）；
 * 3. 自动生成各个 public/[slug]/index.html 及 public/[slug].html 静态跳板（支持 Meta Refresh + JS location.replace）；
 * 4. 自动生成 public/_redirects（Cloudflare Pages 边缘 302 规则）；
 * 5. 自动生成 404.html 客户端智能路由兜底页；
 * 6. 将 __SHORTLINK_MAP__ 注入到 index.html <head>，确保即使被 SPA 机制回退到 index.html 也能瞬间执行跳转；
 * 7. 支持 --sync-html 参数将 index.html 中的卡片 href 同步替换为短链 (https://jiakuan.link/xxxxx)。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const BASE_URL = 'https://jiakuan.link';
const MAP_FILE = path.resolve(ROOT_DIR, 'links-map.json');
const INDEX_HTML_FILE = path.resolve(ROOT_DIR, 'index.html');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const ROOT_404_FILE = path.resolve(ROOT_DIR, '404.html');

// 排除可能与网站现有路由冲突的保留词
const RESERVED_SLUGS = new Set([
  'guide', 'admin', 'asset', 'image', 'fonts', 'media', 'about',
  'index', 'login', 'share', 'terms', 'links', 'nodes', 'stats',
  'reset', 'style', 'tests', 'debug', 'error', 'setup', 'pages',
  'posts', 'files', 'cloud', 'robot', 'swjs0', 'cname'
]);

/**
 * 生成 5 位随机小写字母
 */
function generateRandom5LetterSlug(existingSlugs) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  while (true) {
    let slug = '';
    const bytes = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) {
      slug += letters[bytes[i] % 26];
    }
    if (!existingSlugs.has(slug) && !RESERVED_SLUGS.has(slug)) {
      return slug;
    }
  }
}

/**
 * 转移字符，防止 HTML 注入
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 生成单个短链静态 HTML 跳板
 */
function renderRedirectHtml(title, targetUrl, slug) {
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(targetUrl);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>正在前往 ${safeTitle}...</title>
    <meta http-equiv="refresh" content="0; url=${safeUrl}">
    <meta name="robots" content="noindex, nofollow">
    <link rel="canonical" href="${safeUrl}">
    <script>
        (function() {
            try {
                window.location.replace("${targetUrl.replace(/"/g, '\\"')}");
            } catch(e) {
                window.location.href = "${targetUrl.replace(/"/g, '\\"')}";
            }
        })();
    </script>
    <style>
        body {
            background-color: #0b0f19;
            color: #94a3b8;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
            text-align: center;
        }
        .container {
            max-width: 460px;
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 32px 24px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(12px);
        }
        .spinner {
            width: 36px;
            height: 36px;
            border: 3px solid rgba(56, 189, 248, 0.2);
            border-top-color: #38bdf8;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .title {
            font-size: 1.15rem;
            color: #f1f5f9;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .desc {
            font-size: 0.875rem;
            color: #64748b;
            line-height: 1.6;
        }
        .link {
            display: inline-block;
            margin-top: 14px;
            color: #38bdf8;
            text-decoration: underline;
            font-size: 0.875rem;
            word-break: break-all;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <div class="title">正在前往 ${safeTitle}...</div>
        <div class="desc">若浏览器未在数秒内自动跳转，请点击下方链接直接访问：</div>
        <a class="link" href="${safeUrl}">点击直接前往</a>
    </div>
</body>
</html>
`;
}

/**
 * 生成 404 智能兜底 HTML
 */
function render404Html(slugMap) {
  const mapJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(slugMap).map(([slug, info]) => [slug, info.target])
    )
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>页面重定向中 - 家宽导航</title>
    <meta name="robots" content="noindex, nofollow">
    <script>
        (function() {
            var map = ${mapJson};
            var path = window.location.pathname.replace(/^\\/+|\\/+$/g, '').toLowerCase();
            var slug = path.split('/').pop();
            if (map[slug]) {
                window.location.replace(map[slug]);
                return;
            }
        })();
    </script>
    <style>
        body {
            background-color: #0b0f19;
            color: #94a3b8;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            text-align: center;
        }
        .card {
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 40px 28px;
            max-width: 440px;
        }
        h1 { font-size: 2rem; color: #f1f5f9; margin-bottom: 12px; }
        p { font-size: 0.95rem; color: #64748b; line-height: 1.6; }
        a.btn {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 24px;
            background: #0284c7;
            color: #fff;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>404</h1>
        <p>抱歉，您访问的链接不存在或已迁移。</p>
        <a class="btn" href="/">返回家宽导航首页</a>
    </div>
</body>
</html>
`;
}

/**
 * 主执行函数
 */
export async function main() {
  const syncHtml = process.argv.includes('--sync-html');

  // 1. 读取或初始化 links-map.json
  let linksMap = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    } catch (err) {
      console.warn('[Warning] 读取 links-map.json 失败，将重新初始化:', err.message);
    }
  }

  // 2. 建立已有的 slug 与 target 反查表
  const existingSlugs = new Set(Object.keys(linksMap));
  const targetToSlug = new Map();
  for (const [slug, item] of Object.entries(linksMap)) {
    if (item.target) {
      targetToSlug.set(item.target, slug);
    }
  }

  // 3. 读取 index.html 并提取所有卡片
  if (!fs.existsSync(INDEX_HTML_FILE)) {
    console.error('[Error] 未找到 index.html');
    process.exit(1);
  }

  let indexHtml = fs.readFileSync(INDEX_HTML_FILE, 'utf8');

  // 匹配所有 class 包含 button-xzwl 的卡片
  const cardBlockRegex = /<a\b[^>]*class=["'][^"']*button-xzwl[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  let match;
  const cards = [];

  while ((match = cardBlockRegex.exec(indexHtml)) !== null) {
    const cardHtml = match[0];
    const startIndex = match.index;
    const endIndex = startIndex + cardHtml.length;

    const hrefMatch = cardHtml.match(/href=["']([^"']+)["']/i);
    const titleMatch = cardHtml.match(/<h3\b[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([^<]+)<\/h3>/i);
    const catMatch = cardHtml.match(/data-category=["']([^"']+)["']/i);

    if (hrefMatch) {
      cards.push({
        raw: cardHtml,
        href: hrefMatch[1],
        title: titleMatch ? titleMatch[1].trim() : 'Unknown',
        category: catMatch ? catMatch[1].trim() : 'airport',
        startIndex,
        endIndex
      });
    }
  }

  console.log(`[Info] 成功扫描到 ${cards.length} 个推荐卡片。`);

  // 4. 为每个卡片确定 5 位字母 shortlink
  let newSlugsCount = 0;
  let updatedHtml = indexHtml;
  const replacements = [];

  for (const card of cards) {
    let slug = null;

    // 检查是否已经是 https://jiakuan.link/xxxxx 格式
    const shortlinkMatch = card.href.match(/^https?:\/\/jiakuan\.link\/([a-z]{5})\/?$/i);
    if (shortlinkMatch) {
      slug = shortlinkMatch[1].toLowerCase();
      // 如果映射表中已有记录，保持
      if (!linksMap[slug]) {
        console.log(`[Info] 发现已有短链但未在 map 中: ${slug} (${card.title})`);
        linksMap[slug] = {
          title: card.title,
          target: card.href,
          category: card.category,
          updatedAt: new Date().toISOString().split('T')[0]
        };
        existingSlugs.add(slug);
      }
    } else {
      // 是原始外链
      if (targetToSlug.has(card.href)) {
        slug = targetToSlug.get(card.href);
      } else {
        // 特殊样例：如果卡片标题为 rancho 且未被占用，优先赋予用户示例指定的 'dsiug'
        if (card.title.toLowerCase() === 'rancho' && !existingSlugs.has('dsiug')) {
          slug = 'dsiug';
        } else {
          slug = generateRandom5LetterSlug(existingSlugs);
        }

        existingSlugs.add(slug);
        targetToSlug.set(card.href, slug);
        linksMap[slug] = {
          title: card.title,
          target: card.href,
          category: card.category,
          createdAt: new Date().toISOString().split('T')[0]
        };
        newSlugsCount++;
      }

      // 如果需要同步 index.html
      if (syncHtml) {
        const newHref = `${BASE_URL}/${slug}`;
        const newCardHtml = card.raw.replace(/href=["'][^"']+["']/i, `href="${newHref}"`);
        replacements.push({
          startIndex: card.startIndex,
          endIndex: card.endIndex,
          newContent: newCardHtml
        });
      }
    }
  }

  // 5. 如果开启了 --sync-html，执行替换卡片 href
  if (syncHtml && replacements.length > 0) {
    replacements.sort((a, b) => b.startIndex - a.startIndex);
    for (const r of replacements) {
      updatedHtml = updatedHtml.slice(0, r.startIndex) + r.newContent + updatedHtml.slice(r.endIndex);
    }
    console.log(`[Success] 已同步更新 index.html 中的 ${replacements.length} 个卡片链接为短链！`);
  }

  // 6. 保存 links-map.json
  const sortedMap = Object.keys(linksMap)
    .sort()
    .reduce((acc, key) => {
      acc[key] = linksMap[key];
      return acc;
    }, {});

  fs.writeFileSync(MAP_FILE, JSON.stringify(sortedMap, null, 2) + '\n', 'utf8');
  console.log(`[Success] links-map.json 已更新，当前维护 ${Object.keys(sortedMap).length} 个短链（新增 ${newSlugsCount} 个）。`);

  // 7. 更新 index.html 中的短链路由与本地跳转支持（无论是否传入 --sync-html）
  const targetMapObj = Object.fromEntries(
    Object.entries(sortedMap).map(([s, item]) => [s, item.target])
  );
  const routerCode = `<!-- SHORTLINK_ROUTER_START -->
    <script>
        (function() {
            try {
                window.__SHORTLINK_MAP__ = ${JSON.stringify(targetMapObj)};
                var p = window.location.pathname.replace(/^\\/+|\\/+$/g, '').toLowerCase().split('/').pop();
                if (p && window.__SHORTLINK_MAP__[p]) {
                    window.location.replace(window.__SHORTLINK_MAP__[p]);
                }
            } catch(e) {}
        })();
    </script>
    <!-- SHORTLINK_ROUTER_END -->`;

  let finalHtml = updatedHtml;
  if (finalHtml.includes('<!-- SHORTLINK_ROUTER_START -->')) {
    finalHtml = finalHtml.replace(/<!-- SHORTLINK_ROUTER_START -->[\s\S]*?<!-- SHORTLINK_ROUTER_END -->/, routerCode);
  } else {
    // 注入到 <head> 顶部
    finalHtml = finalHtml.replace('<head>', `<head>\n    ${routerCode}`);
  }

  fs.writeFileSync(INDEX_HTML_FILE, finalHtml, 'utf8');

  // 8. 生成 public/ 下的静态跳板目录、.html 及 index.html
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  const redirectLines = ['# Cloudflare Pages 302 Redirects'];

  for (const [slug, item] of Object.entries(sortedMap)) {
    if (!item.target || item.target.startsWith(BASE_URL)) {
      continue;
    }

    const htmlContent = renderRedirectHtml(item.title, item.target, slug);

    // 目录型：public/[slug]/index.html
    const slugDir = path.resolve(PUBLIC_DIR, slug);
    if (!fs.existsSync(slugDir)) {
      fs.mkdirSync(slugDir, { recursive: true });
    }
    fs.writeFileSync(path.resolve(slugDir, 'index.html'), htmlContent, 'utf8');

    // Clean URL 型：public/[slug].html
    fs.writeFileSync(path.resolve(PUBLIC_DIR, `${slug}.html`), htmlContent, 'utf8');

    // 如果 dist 目录已存在，同步写入 dist
    if (fs.existsSync(DIST_DIR)) {
      const distSlugDir = path.resolve(DIST_DIR, slug);
      if (!fs.existsSync(distSlugDir)) {
        fs.mkdirSync(distSlugDir, { recursive: true });
      }
      fs.writeFileSync(path.resolve(distSlugDir, 'index.html'), htmlContent, 'utf8');
      fs.writeFileSync(path.resolve(DIST_DIR, `${slug}.html`), htmlContent, 'utf8');
    }

    redirectLines.push(`/${slug}  ${item.target}  302!`);
  }

  // 9. 写入 public/_redirects
  const redirectsContent = redirectLines.join('\n') + '\n';
  fs.writeFileSync(path.resolve(PUBLIC_DIR, '_redirects'), redirectsContent, 'utf8');
  if (fs.existsSync(DIST_DIR)) {
    fs.writeFileSync(path.resolve(DIST_DIR, '_redirects'), redirectsContent, 'utf8');
  }

  // 10. 生成 404.html (根目录与 public 目录)
  const fallback404Content = render404Html(sortedMap);
  fs.writeFileSync(ROOT_404_FILE, fallback404Content, 'utf8');
  fs.writeFileSync(path.resolve(PUBLIC_DIR, '404.html'), fallback404Content, 'utf8');
  if (fs.existsSync(DIST_DIR)) {
    fs.writeFileSync(path.resolve(DIST_DIR, '404.html'), fallback404Content, 'utf8');
  }

  console.log(`[Success] 全部静态跳转页、_redirects、404.html 和 index.html 路由构建完成！`);
}

// 允许 CLI 直接调用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[Error] 执行异常:', err);
    process.exit(1);
  });
}
