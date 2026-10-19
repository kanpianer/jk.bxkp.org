/**
 * scripts/generate-links.js
 *
 * 自动化短链接生成与跳转跳板构建工具
 * 功能：
 * 1. 扫描 index.html 中的推荐卡片，维护 links-map.json 单一真相源；
 * 2. 将每个网站卡片绑定至指定的固定自定义短链接（如 rancho -> /rancho，RESIP -> /resip）；
 * 3. 源链接在 index.html 或 links-map.json 中发生任何更新变动时，短链保持固定不变并自动重定向至最新网址；
 * 4. 自动生成 go/[slug].html 静态跳板，并生成根 _redirects 将 /[slug] 重写至 /go/[slug].html；
 * 5. 自动生成各个 public/[slug]/index.html 及 public/[slug].html 静态跳板（供 vite/dist 产物使用）；
 * 6. 自动生成 public/_redirects（Cloudflare Pages 边缘 302 规则）与仓库根 _redirects；
 * 7. 自动生成 404.html 客户端智能路由兜底页（根目录提供最终兜底）；
 * 8. 将 __SHORTLINK_MAP__ 注入到 index.html <head>，确保即使被 SPA 机制回退到 index.html 也能瞬间执行跳转；
 * 9. 支持 --no-sync-html 参数跳过 index.html 卡片 href 的短链回写。
 *
 * 模板唯一来源：js/shortlink-templates.js（在线 CMS 与本脚本共用，避免两端产物漂移）。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseCardsFromHtml } from './cms-service.mjs';
import {
  SHORTLINK_BASE_URL,
  renderRedirectHtml,
  render404Html,
  injectShortlinkRouter,
  collectFallbackEntries
} from '../js/shortlink-templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const BASE_URL = SHORTLINK_BASE_URL;
const MAP_FILE = path.resolve(ROOT_DIR, 'links-map.json');
const INDEX_HTML_FILE = path.resolve(ROOT_DIR, 'index.html');
const PUBLIC_DIR = path.resolve(ROOT_DIR, 'public');
const GO_DIR = path.resolve(ROOT_DIR, 'go');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const ROOT_404_FILE = path.resolve(ROOT_DIR, '404.html');
const README_FILE = path.resolve(ROOT_DIR, 'README.md');

// 排除可能与网站系统路由或核心静态资源冲突的保留词
const RESERVED_SLUGS = new Set([
  'guide', 'admin', 'dtms', 'go', 'donttouchmyshit', 'asset', 'image', 'fonts', 'media', 'about',
  'index', 'login', 'share', 'terms', 'links', 'nodes', 'stats',
  'reset', 'style', 'tests', 'debug', 'error', 'setup', 'pages',
  'posts', 'files', 'cloud', 'robot', 'swjs0', 'cname'
]);

// 官方分类的自定义短链路由映射
const CATEGORY_LINKS = {
  old: {
    title: '老站',
    target: '/#old',
    category: 'noble'
  },
  vps: {
    title: 'VPS',
    target: '/#vps',
    category: 'vps'
  }
};

// 网站名称与固定自定义短链映射表 (忽略大小写与 ! # 前缀)
const FIXED_SLUG_MAP = {
  'resip': 'resip',
  '网际快车': 'wjkc',
  '唯兔云': 'wty',
  '蓝通': 'lt',
  '仙路湾': 'xlw',
  '精靈學院': 'jlxy',
  'miaona': 'miao',
  '大象网络': 'dxwl',
  'now加速': 'now',
  'nvenix': 'nvenix',
  'equaldcdn': 'equal',
  'homeproxy': 'hp',
  '影子': 'yz',
  '云帆': 'yf',
  'rancho': 'rancho',
  'mesl': 'mesl',
  'tag': 'tag',
  'godetia': 'godetia',
  'cloudie': 'cloudie',
  'oixcloud': 'oix',
  'ftq': 'ftq',
  'biubiu': 'biu',
  'ss-id': 'ssid',
  'just my socks': 'jms',
  'sntp': 'sntp',
  'e-ix': 'eix',
  '青云梯': 'qyt',
  'bitz net': 'bitz',
  'glados': 'glados',
  'linkcube': 'lc',
  '学长网络': 'xzwl',
  'lamhosting llc': 'lam',
  '干杯cloud': 'ganbei',
  'ohno': 'ohno',
  'zorocloud': 'zoro',
  'voyracloud': 'voyra',
  'akilecloud': 'akile',
  'voluri': 'voluri',
  'sixtynet': 'sixty',
  'soladrive': 'sola',
  'residential-idc': 'ridc',
  'qq.pw': 'qqpw',
  'blossom主机': 'blossom',
  'blossom host': 'blossom',
  'blossomhost': 'blossom',
  'blossom': 'blossom',
  'attvps': 'attvps'
};

/**
 * 清理卡片标题用于匹配
 */
function normalizeTitle(title) {
  return String(title || '')
    .replace(/^[!！#＃\s]+/, '')
    .trim()
    .toLowerCase();
}

/**
 * 获取标题对应的固定自定义短链
 */
function getCustomSlugForTitle(title) {
  const clean = normalizeTitle(title);
  return FIXED_SLUG_MAP[clean] || null;
}

/**
 * 生成 README.md 中的精选站点表格 (严格排除隐藏卡片)
 */
export function renderReadmeSiteDirectory(cards) {
  const visible = cards.filter((c) => !c.isHidden);

  const categories = [
    { key: 'noble', name: '老站推荐 (Noble)', desc: '经受长期运营检验的高稳定性老牌专线与精品线路服务商。' },
    { key: 'airport', name: '机场推荐 (Airport)', desc: '精选包含住宅IP、全家宽或高质量精品中继线路的机场服务商。' },
    { key: 'vps', name: 'VPS 推荐 (Virtual Private Server)', desc: '适合自主搭建、静态住宅业务、跨境电商独立运营的高性价比 VPS / NAT 主机。' }
  ];

  let output = '';
  for (const cat of categories) {
    const list = visible.filter((c) => c.category === cat.key);
    if (list.length === 0) continue;
    output += `### ${cat.name}\n\n> ${cat.desc}\n\n`;
    output += '| 站点名称 | 推荐级别 | 特性标签 | 价格 / 规格起步 | 快速访问短链 | 官方直达链接 |\n';
    output += '| :--- | :---: | :--- | :--- | :--- | :--- |\n';
    for (const c of list) {
      const rec = c.isHighlight ? '⭐ 重点推荐' : '精选';
      const allTags = [
        ...c.headerTags.map((t) => '`' + t.text + '`'),
        ...(c.metaTag ? ['`' + c.metaTag.text + '`'] : [])
      ];
      const tagStr = allTags.length > 0 ? allTags.join(' ') : '-';
      const price = c.metaText || '-';
      const shortlink = `[jiakuan.link/${c.slug}](https://jiakuan.link/${c.slug})`;
      const direct = c.target ? `[直达官网](${c.target})` : '-';
      output += `| **${c.cleanTitle}** | ${rec} | ${tagStr} | ${price} | ${shortlink} | ${direct} |\n`;
    }
    output += '\n';
  }
  return output.trim();
}

/**
 * 同步更新 README.md 中的站点目录
 */
export function syncReadme(cards) {
  if (!fs.existsSync(README_FILE)) return;
  const content = fs.readFileSync(README_FILE, 'utf8');
  const startMarker = '<!-- SITE_DIRECTORY_START -->';
  const endMarker = '<!-- SITE_DIRECTORY_END -->';

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    const tableContent = renderReadmeSiteDirectory(cards);
    const updated =
      content.substring(0, startIdx + startMarker.length) +
      '\n' +
      tableContent +
      '\n' +
      content.substring(endIdx);
    fs.writeFileSync(README_FILE, updated, 'utf8');
    console.log('[Success] README.md 网站信息已同步更新（已过滤隐藏卡片）！');
  }
}

/**
 * 主执行函数
 */
export async function main() {
  const syncHtml = !process.argv.includes('--no-sync-html');

  // 1. 读取现有的 links-map.json
  let linksMap = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    } catch (err) {
      console.warn('[Warning] 读取 links-map.json 失败，将重新初始化:', err.message);
    }
  }

  // 建立 title -> target 反查表（从现有 links-map.json 中继承已有目标地址）
  const titleToTarget = new Map();
  for (const [slug, item] of Object.entries(linksMap)) {
    if (item.title && item.target && !item.target.startsWith(BASE_URL)) {
      titleToTarget.set(normalizeTitle(item.title), item.target);
    }
  }

  // 记录上一版已登记的短链，用于安全清理已下线的根目录跳板页
  const previousSlugs = new Set(Object.keys(linksMap));

  // 1.1 注入官方分类自定义短链（老站、VPS）
  for (const [slug, item] of Object.entries(CATEGORY_LINKS)) {
    linksMap[slug] = {
      title: item.title,
      target: item.target,
      category: item.category,
      updatedAt: new Date().toISOString().split('T')[0]
    };
  }

  // 2. 读取 index.html 并提取所有卡片
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
    const slugMatch = cardHtml.match(/data-slug=["']([^"']+)["']/i);

    if (hrefMatch) {
      cards.push({
        raw: cardHtml,
        href: hrefMatch[1],
        title: titleMatch ? titleMatch[1].trim() : 'Unknown',
        category: catMatch ? catMatch[1].trim() : 'airport',
        dataSlug: slugMatch ? slugMatch[1].trim() : null,
        startIndex,
        endIndex
      });
    }
  }

  console.log(`[Info] 成功扫描到 ${cards.length} 个推荐卡片。`);

  // 3. 构建新的 newLinksMap，将所有卡片映射到固定自定义短链
  const newLinksMap = {};
  // 保持分类链接
  for (const [slug, item] of Object.entries(CATEGORY_LINKS)) {
    newLinksMap[slug] = {
      title: item.title,
      target: item.target,
      category: item.category
    };
  }

  let updatedHtml = indexHtml;
  const replacements = [];

  for (const card of cards) {
    const customSlug = card.dataSlug || getCustomSlugForTitle(card.title);
    if (!customSlug) {
      console.warn(`[Warning] 未为卡片 "${card.title}" 找到对应的自定义短链配置，跳过。`);
      continue;
    }

    // 确定目标真实网址 (targetUrl):
    let targetUrl = null;

    // 情况 A: 卡片 href 是外链（非以 BASE_URL 或 / 开头），说明维护者在 index.html 中直接更新了源链接
    const isDirectExternal = !card.href.startsWith(BASE_URL) && !card.href.startsWith('/') && !card.href.startsWith('#');
    if (isDirectExternal) {
      targetUrl = card.href;
      console.log(`[Update] 检测到卡片 ${card.title} 在 index.html 中提供了最新源链接: ${targetUrl}`);
    } else {
      // 情况 B: 卡片 href 已经是短链，从 linksMap 或现有记录中查找目标地址
      if (linksMap[customSlug] && linksMap[customSlug].target && !linksMap[customSlug].target.startsWith(BASE_URL)) {
        targetUrl = linksMap[customSlug].target;
      } else {
        // 从旧 slug 或标题反查
        const shortMatch = card.href.match(/^https?:\/\/jiakuan\.link\/([a-z0-9_-]+)/i);
        const oldSlug = shortMatch ? shortMatch[1].toLowerCase() : null;
        if (oldSlug && linksMap[oldSlug] && linksMap[oldSlug].target) {
          targetUrl = linksMap[oldSlug].target;
        } else if (titleToTarget.has(normalizeTitle(card.title))) {
          targetUrl = titleToTarget.get(normalizeTitle(card.title));
        }
      }
    }

    if (!targetUrl) {
      console.error(`[Error] 无法确定卡片 "${card.title}" (${customSlug}) 的目标链接！`);
      continue;
    }

    // 记录到新的 newLinksMap
    newLinksMap[customSlug] = {
      title: card.title,
      target: targetUrl,
      category: card.category,
      updatedAt: new Date().toISOString().split('T')[0]
    };

    // 如果需要同步 index.html
    if (syncHtml) {
      const newHref = `${BASE_URL}/${customSlug}`;
      let newCardHtml = card.raw.replace(/href=["'][^"']+["']/i, `href="${newHref}"`);
      // 保证带有 data-slug 属性，确保源链接更新时永远锁定短链
      if (/data-slug=["'][^"']+["']/i.test(newCardHtml)) {
        newCardHtml = newCardHtml.replace(/data-slug=["'][^"']+["']/i, `data-slug="${customSlug}"`);
      } else {
        newCardHtml = newCardHtml.replace(/<a\b/i, `<a data-slug="${customSlug}"`);
      }

      replacements.push({
        startIndex: card.startIndex,
        endIndex: card.endIndex,
        newContent: newCardHtml
      });
    }
  }

  // 4. 同步更新 index.html 中的卡片链接为自定义短链
  if (syncHtml && replacements.length > 0) {
    replacements.sort((a, b) => b.startIndex - a.startIndex);
    for (const r of replacements) {
      updatedHtml = updatedHtml.slice(0, r.startIndex) + r.newContent + updatedHtml.slice(r.endIndex);
    }
    console.log(`[Success] 已同步更新 index.html 中的 ${replacements.length} 个卡片链接为固定自定义短链！`);
  }

  // 5. 保存 links-map.json
  const sortedMap = Object.keys(newLinksMap)
    .sort()
    .reduce((acc, key) => {
      acc[key] = newLinksMap[key];
      return acc;
    }, {});

  fs.writeFileSync(MAP_FILE, JSON.stringify(sortedMap, null, 2) + '\n', 'utf8');
  console.log(`[Success] links-map.json 已更新，当前维护 ${Object.keys(sortedMap).length} 个固定短链。`);

  // 6. 更新 index.html 中的顶部短链路由（与在线 CMS 共用同一份模板）
  const finalHtml = injectShortlinkRouter(updatedHtml, sortedMap);

  fs.writeFileSync(INDEX_HTML_FILE, finalHtml, 'utf8');

  // 7. 清理 public/ 和 dist/ 中旧的 5 位无用跳板目录
  for (const targetDir of [PUBLIC_DIR, DIST_DIR]) {
    if (fs.existsSync(targetDir)) {
      const existingEntries = fs.readdirSync(targetDir);
      for (const entry of existingEntries) {
        const fullPath = path.resolve(targetDir, entry);
        // 如果是 5 位小写纯字母，且不在新的 sortedMap 中，且不是保留词，清理旧目录/文件
        if (/^[a-z]{5}$/.test(entry) && !sortedMap[entry] && !RESERVED_SLUGS.has(entry)) {
          if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } else if (/^[a-z]{5}\.html$/.test(entry)) {
          const base = entry.replace(/\.html$/, '');
          if (!sortedMap[base] && !RESERVED_SLUGS.has(base)) {
            fs.unlinkSync(fullPath);
          }
        }
      }
    }
  }

  // 7.1 清理已从 links-map.json 下线的短链跳板（只删上一版登记过的短链，绝不误删人工文件）
  for (const slug of previousSlugs) {
    if (sortedMap[slug] || RESERVED_SLUGS.has(slug)) continue;
    for (const staleFile of [
      path.resolve(GO_DIR, `${slug}.html`),
      // 兼容清理旧版本遗留在仓库根目录的跳板文件
      path.resolve(ROOT_DIR, `${slug}.html`)
    ]) {
      if (fs.existsSync(staleFile)) {
        fs.unlinkSync(staleFile);
        console.log(`[Clean] 已移除下线的短链跳板: ${path.relative(ROOT_DIR, staleFile)}`);
      }
    }
  }

  // 8. 生成 go/ / public / dist 下的静态跳板目录、.html 及 index.html
  for (const dir of [GO_DIR, PUBLIC_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const redirectLines = ['# Cloudflare Pages 302 Redirects'];
  const rootRedirectLines = ['# Root clean-URL rewrites for /go jump pages'];

  for (const [slug, item] of collectFallbackEntries(sortedMap, BASE_URL)) {
    const htmlContent = renderRedirectHtml(item.title, item.target, slug);

    // 根目录统一收纳：go/[slug].html，由仓库根 _redirects 将 /[slug] 重写到此
    fs.writeFileSync(path.resolve(GO_DIR, `${slug}.html`), htmlContent, 'utf8');

    // 目录型跳板：public/[slug]/index.html
    const slugDir = path.resolve(PUBLIC_DIR, slug);
    if (!fs.existsSync(slugDir)) {
      fs.mkdirSync(slugDir, { recursive: true });
    }
    fs.writeFileSync(path.resolve(slugDir, 'index.html'), htmlContent, 'utf8');

    // Clean URL 型跳板：public/[slug].html
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
    rootRedirectLines.push(`/${slug}  /go/${slug}.html  200`);
  }

  // /dtms/ 为真实目录入口，无需额外的 Clean URL 重写规则

  // 9. 写入 public/_redirects 与仓库根 _redirects（根目录部署时保持 /[slug] 可用）
  const redirectsContent = redirectLines.join('\n') + '\n';
  fs.writeFileSync(path.resolve(PUBLIC_DIR, '_redirects'), redirectsContent, 'utf8');
  fs.writeFileSync(path.resolve(ROOT_DIR, '_redirects'), rootRedirectLines.join('\n') + '\n', 'utf8');
  if (fs.existsSync(DIST_DIR)) {
    fs.writeFileSync(path.resolve(DIST_DIR, '_redirects'), redirectsContent, 'utf8');

    // 保证 dist 生产打包包含 /dtms/ CMS 入口
    const distCmsDir = path.resolve(DIST_DIR, 'dtms');
    if (!fs.existsSync(distCmsDir)) {
      fs.mkdirSync(distCmsDir, { recursive: true });
    }
    const adminHtml = path.resolve(ROOT_DIR, 'dtms/index.html');
    if (fs.existsSync(adminHtml)) {
      fs.copyFileSync(adminHtml, path.resolve(distCmsDir, 'index.html'));
    }
  }

  // 10. 生成 404.html (根目录与 public 目录)
  const fallback404Content = render404Html(sortedMap);
  fs.writeFileSync(ROOT_404_FILE, fallback404Content, 'utf8');
  fs.writeFileSync(path.resolve(PUBLIC_DIR, '404.html'), fallback404Content, 'utf8');
  if (fs.existsSync(DIST_DIR)) {
    fs.writeFileSync(path.resolve(DIST_DIR, '404.html'), fallback404Content, 'utf8');
  }

  // 11. 同步更新 README.md (严格过滤隐藏卡片)
  try {
    const detailedCards = parseCardsFromHtml(finalHtml, sortedMap);
    syncReadme(detailedCards);
  } catch (err) {
    console.warn('[Warning] 同步更新 README.md 失败:', err.message);
  }

  console.log(`[Success] 全部固定自定义短链跳板页、_redirects、404.html 和 index.html 路由构建完成！`);
}

// 允许 CLI 直接调用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[Error] 执行异常:', err);
    process.exit(1);
  });
}
