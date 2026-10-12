/**
 * scripts/cms-service.mjs
 *
 * 家宽导航 (jiakuan.link) 内容管理系统 (CMS) 核心数据服务
 * 功能：
 * 1. 深度精准解析 index.html 中的卡片、指南弹窗、SEO FAQ 知识库；
 * 2. 深度精准解析 links-map.json、guides/*.html 与 images/icons/；
 * 3. 序列化更新并回写 index.html 与 links-map.json，保证排版格式 100% 统一；
 * 4. 自动快照备份机制（.cms-backups/）与一键版本回滚；
 * 5. 自动触发 scripts/generate-links.js 重新生成短链跳板与 Cloudflare _redirects；
 * 6. 可选自动升级 sw.js 缓存版本号（如 v1.1.12 -> v1.1.13）；
 * 7. 并发链接健康度体检器（检测 404/500/超时链接）；
 * 8. 图标上传与管理；
 * 9. Git 自动 Commit & Push 联动。
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, '..');
export const INDEX_HTML_FILE = path.resolve(ROOT_DIR, 'index.html');
export const MAP_FILE = path.resolve(ROOT_DIR, 'links-map.json');
export const ICONS_DIR = path.resolve(ROOT_DIR, 'images/icons');
export const GUIDES_DIR = path.resolve(ROOT_DIR, 'guides');
export const SW_FILE = path.resolve(ROOT_DIR, 'sw.js');
export const BACKUP_DIR = path.resolve(ROOT_DIR, '.cms-backups');

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 创建快照备份
 */
export function createBackup(note = 'auto') {
  ensureDir(BACKUP_DIR);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const targetSubDir = path.resolve(BACKUP_DIR, `backup_${timestamp}_${note}`);
  ensureDir(targetSubDir);

  if (fs.existsSync(INDEX_HTML_FILE)) {
    fs.copyFileSync(INDEX_HTML_FILE, path.resolve(targetSubDir, 'index.html'));
  }
  if (fs.existsSync(MAP_FILE)) {
    fs.copyFileSync(MAP_FILE, path.resolve(targetSubDir, 'links-map.json'));
  }
  if (fs.existsSync(SW_FILE)) {
    fs.copyFileSync(SW_FILE, path.resolve(targetSubDir, 'sw.js'));
  }

  const meta = {
    timestamp,
    note,
    createdAt: now.toISOString()
  };
  fs.writeFileSync(path.resolve(targetSubDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

/**
 * 列出所有备份
 */
export function listBackups() {
  ensureDir(BACKUP_DIR);
  const entries = fs.readdirSync(BACKUP_DIR);
  const backups = [];

  for (const entry of entries) {
    const fullPath = path.resolve(BACKUP_DIR, entry);
    if (fs.statSync(fullPath).isDirectory() && entry.startsWith('backup_')) {
      const metaFile = path.resolve(fullPath, 'meta.json');
      let meta = { id: entry };
      if (fs.existsSync(metaFile)) {
        try {
          meta = { ...meta, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
        } catch (e) {}
      }
      backups.push({
        id: entry,
        ...meta
      });
    }
  }

  return backups.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

/**
 * 恢复指定备份
 */
export function restoreBackup(backupId) {
  const targetSubDir = path.resolve(BACKUP_DIR, backupId);
  if (!fs.existsSync(targetSubDir)) {
    throw new Error(`备份 ${backupId} 不存在`);
  }

  // 先为当前现场留一份安全兜底备份
  createBackup('before_restore');

  const idxFile = path.resolve(targetSubDir, 'index.html');
  const mapFile = path.resolve(targetSubDir, 'links-map.json');
  const swFile = path.resolve(targetSubDir, 'sw.js');

  if (fs.existsSync(idxFile)) {
    fs.copyFileSync(idxFile, INDEX_HTML_FILE);
  }
  if (fs.existsSync(mapFile)) {
    fs.copyFileSync(mapFile, MAP_FILE);
  }
  if (fs.existsSync(swFile)) {
    fs.copyFileSync(swFile, SW_FILE);
  }

  return { success: true, restored: backupId };
}

/**
 * 获取可用图标列表
 */
export function getAvailableIcons() {
  ensureDir(ICONS_DIR);
  const files = fs.readdirSync(ICONS_DIR);
  return files
    .filter((f) => /\.(png|svg|ico|webp|jpg|jpeg)$/i.test(f))
    .sort()
    .map((filename) => {
      const fullPath = path.resolve(ICONS_DIR, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        path: `images/icons/${filename}`,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    });
}

/**
 * 获取 Service Worker 版本
 */
export function getSwVersion() {
  if (!fs.existsSync(SW_FILE)) return 'v1.0.0';
  const content = fs.readFileSync(SW_FILE, 'utf8');
  const m = content.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : 'v1.0.0';
}

/**
 * 递增 Service Worker 版本号 (例如 v1.1.12 -> v1.1.13)
 */
export function bumpSwVersion() {
  if (!fs.existsSync(SW_FILE)) return 'v1.0.0';
  let content = fs.readFileSync(SW_FILE, 'utf8');
  const m = content.match(/CACHE_VERSION\s*=\s*['"]v(\d+)\.(\d+)\.(\d+)['"]/);
  if (m) {
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    const patch = parseInt(m[3], 10) + 1;
    const newVersion = `v${major}.${minor}.${patch}`;
    content = content.replace(/CACHE_VERSION\s*=\s*['"][^'"]+['"]/, `CACHE_VERSION = '${newVersion}'`);
    fs.writeFileSync(SW_FILE, content, 'utf8');
    return newVersion;
  }
  return getSwVersion();
}

/**
 * 解析所有卡片
 */
export function parseCardsFromHtml(html, linksMap = {}) {
  const cardRegex = /<!--\s*([^\n\r]+?)\s*-->\s*(<a\b[^>]*class=["'][^"']*button-xzwl[^\"']*["'][^>]*>[\s\S]*?<\/a>)/gi;
  let match;
  const cards = [];

  while ((match = cardRegex.exec(html)) !== null) {
    const commentTitle = match[1];
    const cardHtml = match[2];

    const slugMatch = cardHtml.match(/data-slug=["']([^"']+)["']/i);
    const slug = slugMatch ? slugMatch[1] : '';

    const catMatch = cardHtml.match(/data-category=["']([^"']+)["']/i);
    const category = catMatch ? catMatch[1] : 'airport';

    const iconMatch = cardHtml.match(/<img[^>]*class=["'][^"']*icon[^"']*["'][^>]*src=["']([^"']+)["']/i);
    const icon = iconMatch ? iconMatch[1] : '';

    const titleMatch = cardHtml.match(/<h3[^>]*class=["'][^"']*card-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
    const rawTitle = titleMatch ? titleMatch[1].trim() : commentTitle;
    const isHighlight = rawTitle.startsWith('#') || rawTitle.startsWith('＃');
    const isHidden = rawTitle.startsWith('!') || rawTitle.startsWith('！') || cardHtml.includes('card-hidden');
    const cleanTitle = rawTitle.replace(/^[!！#＃\s]+/, '').trim();

    // 解析 card-header 中的标签
    const headerMatch = cardHtml.match(/<div class=["']card-header["']>([\s\S]*?)<\/div>/i);
    let headerTags = [];
    if (headerMatch) {
      const tagMatches = [...headerMatch[1].matchAll(/<span class=["']card-tag\s*([^"']*)["']>([\s\S]*?)<\/span>/gi)];
      headerTags = tagMatches.map((m) => ({ cls: m[1].trim(), text: m[2].trim() }));
    }

    // 解析 card-meta 中的文本与标签
    const metaMatch = cardHtml.match(/<div class=["']card-meta["']>([\s\S]*?)<\/div>/i);
    let metaText = '';
    let metaTag = null;
    if (metaMatch) {
      const metaTagMatch = metaMatch[1].match(/<span class=["']card-tag\s*([^"']*)["']>([\s\S]*?)<\/span>/i);
      if (metaTagMatch) {
        metaTag = { cls: metaTagMatch[1].trim(), text: metaTagMatch[2].trim() };
        metaText = metaMatch[1].replace(metaTagMatch[0], '').trim();
      } else {
        metaText = metaMatch[1].trim();
      }
    }

    const target = linksMap[slug]?.target || '';

    cards.push({
      slug,
      commentTitle,
      rawTitle,
      cleanTitle,
      isHighlight,
      isHidden,
      category,
      icon,
      headerTags,
      metaText,
      metaTag,
      target
    });
  }

  return cards;
}

/**
 * 解析指南弹窗中的条目
 */
export function parseGuideModalItems(html) {
  const modalBodyRegex = /<div class=["']guide-modal-body["']>([\s\S]*?)<\/div>\s*<\/div>\s*<\/dialog>/i;
  const match = html.match(modalBodyRegex);
  if (!match) return [];

  const listItems = [...match[1].matchAll(/<li class=["']guide-item["']>([\s\S]*?)<\/li>/gi)];
  return listItems.map((m, idx) => {
    const textMatch = m[1].match(/<div class=["']guide-item-text["']>([\s\S]*?)<\/div>/i);
    return {
      index: idx + 1,
      content: textMatch ? textMatch[1].trim() : ''
    };
  });
}

/**
 * 解析 SEO FAQ 条目
 */
export function parseFaqItems(html) {
  const faqAccordionRegex = /<div class=["']faq-accordion["']>([\s\S]*?)<\/div>\s*<\/article>/i;
  const match = html.match(faqAccordionRegex);
  if (!match) return [];

  const detailsMatches = [...match[1].matchAll(/<details class=["']faq-item["']>([\s\S]*?)<\/details>/gi)];
  return detailsMatches.map((d) => {
    const qMatch = d[1].match(/<summary class=["']faq-question["']>([\s\S]*?)<\/summary>/i);
    const aMatch = d[1].match(/<div class=["']faq-answer["']>([\s\S]*?)<\/div>/i);
    return {
      question: qMatch ? qMatch[1].trim() : '',
      answer: aMatch ? aMatch[1].trim() : ''
    };
  });
}

/**
 * 解析深度指南文章列表
 */
export function parseGuideArticles() {
  ensureDir(GUIDES_DIR);
  const files = fs.readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.html'));
  const articles = [];

  for (const filename of files) {
    const filePath = path.resolve(GUIDES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
    const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const h1Match = content.match(/<h1 class=["']guide-title["']>([\s\S]*?)<\/h1>/i);
    const articleMatch = content.match(/<article class=["']guide-article["']>([\s\S]*?)<\/article>/i);

    articles.push({
      filename,
      slug: filename.replace(/\.html$/, ''),
      path: `guides/${filename}`,
      title: titleMatch ? titleMatch[1].trim() : filename,
      headline: h1Match ? h1Match[1].trim() : '',
      description: descMatch ? descMatch[1].trim() : '',
      contentHtml: articleMatch ? articleMatch[1].trim() : '',
      rawHtml: content
    });
  }

  return articles;
}

/**
 * 单张卡片渲染为标准 HTML
 */
export function renderCardHtml(card) {
  const isAirport = card.category === 'airport';
  const displayTitle = (card.isHighlight ? '#' : (card.isHidden ? '!' : '')) + card.cleanTitle;
  const cardHiddenClass = card.isHidden ? ' card-hidden' : '';
  const filterClass = isAirport ? '' : ' category-filtered-out';
  const displayStyle = isAirport ? '' : ' style="display: none;"';

  let headerTagsHtml = '';
  if (card.headerTags && card.headerTags.length > 0) {
    headerTagsHtml = '\n                            ' + card.headerTags
      .filter((t) => t && t.text)
      .map((t) => `<span class="card-tag ${t.cls || ''}">${t.text}</span>`)
      .join('\n                            ');
  }

  let metaTagHtml = '';
  if (card.metaTag && card.metaTag.text) {
    metaTagHtml = ` <span class="card-tag ${card.metaTag.cls || ''}">${card.metaTag.text}</span>`;
  }

  return `                <!-- ${card.cleanTitle} -->
                <a data-slug="${card.slug}" class="button button-xzwl${cardHiddenClass}${filterClass}" href="https://jiakuan.link/${card.slug}" target="_blank"
                    rel="sponsored noopener" role="button" data-category="${card.category}"${displayStyle}>
                    <img class="icon" aria-hidden="true" src="${card.icon}" alt="${card.cleanTitle} Logo" width="30" height="30" loading="lazy" decoding="async">
                    <div class="card-info">
                        <div class="card-header">
                            <h3 class="card-title">${displayTitle}</h3>${headerTagsHtml}
                        </div>
                        <div class="card-meta">${card.metaText || ''}${metaTagHtml}</div>
                    </div>
                </a>`;
}

/**
 * 生成完整的 button-stack 区域 HTML
 */
export function renderButtonStackHtml(cards) {
  // 分组并确保置顶卡片排在前面
  const sortFn = (a, b) => (b.isHighlight ? 1 : 0) - (a.isHighlight ? 1 : 0);
  const nobleCards = cards.filter((c) => c.category === 'noble').sort(sortFn);
  const airportCards = cards.filter((c) => c.category === 'airport').sort(sortFn);
  const vpsCards = cards.filter((c) => c.category === 'vps').sort(sortFn);
  const otherCards = cards.filter((c) => !['noble', 'airport', 'vps'].includes(c.category)).sort(sortFn);

  const sections = [];

  if (nobleCards.length > 0) {
    sections.push('                <!-- ========== 老站 ========== -->\n' + nobleCards.map(renderCardHtml).join('\n\n'));
  }
  if (airportCards.length > 0) {
    sections.push('                <!-- ========== 机场 ========== -->\n' + airportCards.map(renderCardHtml).join('\n\n'));
  }
  if (vpsCards.length > 0) {
    sections.push('                <!-- ========== VPS ========== -->\n' + vpsCards.map(renderCardHtml).join('\n\n'));
  }
  if (otherCards.length > 0) {
    sections.push('                <!-- ========== 其他 ========== -->\n' + otherCards.map(renderCardHtml).join('\n\n'));
  }

  return `            <div class="button-stack" role="navigation">\n\n${sections.join('\n\n\n')}\n\n            </div>`;
}

/**
 * 生成指南弹窗 HTML 块
 */
export function renderGuideModalBodyHtml(items) {
  const itemsHtml = items.map((it, idx) => `                    <li class="guide-item">
                        <span class="guide-item-badge">${idx + 1}</span>
                        <div class="guide-item-text">
                            ${it.content}
                        </div>
                    </li>`).join('\n');

  return `            <div class="guide-modal-body">
                <ol class="guide-list">
${itemsHtml}
                </ol>
            </div>`;
}

/**
 * 生成 FAQ Accordion HTML 块
 */
export function renderFaqAccordionHtml(faqs) {
  const faqsHtml = faqs.map((f) => `                        <details class="faq-item">
                            <summary class="faq-question">${f.question}</summary>
                            <div class="faq-answer">
                                ${f.answer}
                            </div>
                        </details>`).join('\n');

  return `                    <div class="faq-accordion">\n${faqsHtml}\n                    </div>`;
}

/**
 * 读取全量 CMS 数据
 */
export function readAllData() {
  if (!fs.existsSync(INDEX_HTML_FILE)) {
    throw new Error('未找到 index.html');
  }

  const indexHtml = fs.readFileSync(INDEX_HTML_FILE, 'utf8');
  let linksMap = {};
  if (fs.existsSync(MAP_FILE)) {
    try {
      linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    } catch (e) {}
  }

  const cards = parseCardsFromHtml(indexHtml, linksMap);
  const modalItems = parseGuideModalItems(indexHtml);
  const faqItems = parseFaqItems(indexHtml);
  const guideArticles = parseGuideArticles();
  const availableIcons = getAvailableIcons();
  const swVersion = getSwVersion();

  return {
    cards,
    modalItems,
    faqItems,
    guideArticles,
    availableIcons,
    swVersion,
    linksMap
  };
}

/**
 * 执行 generate-links 脚本更新短链跳板
 */
export function runGenerateLinks() {
  return new Promise((resolve, reject) => {
    exec('node scripts/generate-links.js', { cwd: ROOT_DIR }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`构建脚本执行失败: ${stderr || err.message}`));
      }
      resolve(stdout);
    });
  });
}

/**
 * 保存全量 CMS 数据
 */
export async function saveAllData({ cards, modalItems, faqItems, guideArticles, bumpSw = true }) {
  // 1. 创建备份
  createBackup('before_cms_save');

  let html = fs.readFileSync(INDEX_HTML_FILE, 'utf8');

  // 2. 替换 button-stack 区域
  if (Array.isArray(cards)) {
    const stackStart = '<div class="button-stack" role="navigation">';
    const stackEnd = '<!-- 展开隐藏卡片按钮';
    const startIdx = html.indexOf(stackStart);
    const endIdx = html.indexOf(stackEnd, startIdx);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = html.substring(0, startIdx);
      const after = html.substring(endIdx);
      const newStackHtml = renderButtonStackHtml(cards);
      html = before + newStackHtml.trim() + '\n\n            ' + after;
    }
  }

  // 3. 替换指南弹窗区域
  if (Array.isArray(modalItems)) {
    const modalBodyRegex = /<div class=["']guide-modal-body["']>([\s\S]*?)<\/div>\s*<\/div>\s*<\/dialog>/i;
    const match = html.match(modalBodyRegex);
    if (match) {
      const newModalBodyHtml = renderGuideModalBodyHtml(modalItems);
      html = html.replace(modalBodyRegex, `${newModalBodyHtml}\n        </div>\n    </dialog>`);
    }
  }

  // 4. 替换 FAQ 区域与 Schema.org JSON-LD
  if (Array.isArray(faqItems)) {
    const faqAccordionRegex = /<div class=["']faq-accordion["']>([\s\S]*?)<\/div>\s*<\/article>/i;
    const match = html.match(faqAccordionRegex);
    if (match) {
      const newFaqHtml = renderFaqAccordionHtml(faqItems);
      html = html.replace(faqAccordionRegex, `${newFaqHtml}\n                </article>`);
    }

    // 同步更新 Schema.org FAQPage
    const faqSchemaRegex = /"@type":\s*"FAQPage"[\s\S]*?"mainEntity":\s*\[[\s\S]*?\]\s*\}/i;
    const faqSchemaMatch = html.match(faqSchemaRegex);
    if (faqSchemaMatch) {
      const mainEntities = faqItems.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer.replace(/<[^>]+>/g, '').trim()
        }
      }));
      const newSchemaSnippet = `"@type": "FAQPage",\n          "@id": "https://jiakuan.link/#faq",\n          "mainEntity": ${JSON.stringify(mainEntities, null, 12).replace(/\n\s*}/g, '\n          }')}`;
      html = html.replace(faqSchemaRegex, newSchemaSnippet);
    }
  }

  // 写入 index.html
  fs.writeFileSync(INDEX_HTML_FILE, html, 'utf8');

  // 5. 更新 links-map.json
  if (Array.isArray(cards)) {
    let linksMap = {};
    if (fs.existsSync(MAP_FILE)) {
      try {
        linksMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
      } catch (e) {}
    }

    const today = new Date().toISOString().split('T')[0];
    for (const card of cards) {
      if (card.slug && card.target) {
        const displayTitle = (card.isHighlight ? '#' : (card.isHidden ? '!' : '')) + card.cleanTitle;
        linksMap[card.slug] = {
          title: displayTitle,
          target: card.target,
          category: card.category,
          updatedAt: today
        };
      }
    }

    const sortedMap = Object.keys(linksMap)
      .sort()
      .reduce((acc, key) => {
        acc[key] = linksMap[key];
        return acc;
      }, {});

    fs.writeFileSync(MAP_FILE, JSON.stringify(sortedMap, null, 2) + '\n', 'utf8');
  }

  // 6. 如果有被修改的深度文章，一并保存
  if (Array.isArray(guideArticles)) {
    for (const art of guideArticles) {
      if (art && art.filename && (art._modified || art.isModified)) {
        try {
          saveGuideArticle(art);
        } catch (e) {
          console.warn(`[CMS Warning] 自动保存文章 ${art.filename} 失败:`, e.message);
        }
      }
    }
  }

  // 7. 是否递增 Service Worker 缓存版本
  let newSwVersion = getSwVersion();
  if (bumpSw) {
    newSwVersion = bumpSwVersion();
  }

  // 8. 运行 generate-links 脚本同步短链跳板
  let buildOutput = '';
  try {
    buildOutput = await runGenerateLinks();
  } catch (err) {
    console.warn('[CMS Warning] 自动构建跳板警告:', err.message);
  }

  return {
    success: true,
    swVersion: newSwVersion,
    buildOutput
  };
}

/**
 * 保存单个深度指南文章
 */
export function saveGuideArticle({ filename, headline, description, contentHtml }) {
  ensureDir(GUIDES_DIR);
  const targetFile = path.resolve(GUIDES_DIR, filename);
  if (!fs.existsSync(targetFile)) {
    throw new Error(`文章 ${filename} 不存在`);
  }

  let html = fs.readFileSync(targetFile, 'utf8');

  if (description) {
    html = html.replace(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, `<meta name="description" content="${description}">`);
  }
  if (contentHtml) {
    html = html.replace(/<article class=["']guide-article["']>([\s\S]*?)<\/article>/i, `<article class="guide-article">\n${contentHtml}\n            </article>`);
  }
  if (headline) {
    html = html.replace(/<h1 class=["']guide-title["']>([\s\S]*?)<\/h1>/i, `<h1 class="guide-title">${headline}</h1>`);
    html = html.replace(/<title>([^<]+)<\/title>/i, `<title>${headline} | 家宽导航</title>`);
  }

  fs.writeFileSync(targetFile, html, 'utf8');

  // 如果 dist 目录存在，同步写入 dist
  const distFile = path.resolve(ROOT_DIR, 'dist/guides', filename);
  if (fs.existsSync(distFile)) {
    try {
      fs.writeFileSync(distFile, html, 'utf8');
    } catch (e) {}
  }

  return { success: true, filename };
}

/**
 * 保存上传的图标
 */
export function saveUploadedIcon(filename, base64Data) {
  ensureDir(ICONS_DIR);
  // 清洗文件名
  const cleanName = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  const targetPath = path.resolve(ICONS_DIR, cleanName);

  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(targetPath, buffer);

  return {
    success: true,
    filename: cleanName,
    path: `images/icons/${cleanName}`
  };
}

/**
 * 并发链接存活体检器
 */
export async function checkLinkHealth(urls = []) {
  const results = [];
  const timeoutMs = 8000;

  async function checkSingle(url) {
    if (!url || !url.startsWith('http')) {
      return { url, status: 0, ok: false, error: '无效网址' };
    }
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timer);

      const timeMs = Date.now() - start;
      return {
        url,
        status: resp.status,
        ok: resp.status >= 200 && resp.status < 400,
        timeMs
      };
    } catch (err) {
      return {
        url,
        status: 0,
        ok: false,
        error: err.name === 'AbortError' ? '请求超时 (8s)' : err.message,
        timeMs: Date.now() - start
      };
    }
  }

  // 控制并发数为 6，避免被目标平台误判为恶意攻击
  const concurrency = 6;
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map(checkSingle));
    results.push(...chunkRes);
  }

  return results;
}

/**
 * Git 一键 Commit & Push 联动
 */
export function gitCommitAndPush(commitMessage = 'chore: update content via CMS') {
  return new Promise((resolve, reject) => {
    const safeMsg = commitMessage.replace(/"/g, '\\"');
    const cmd = `git add . && git commit -m "${safeMsg}" && git push`;

    exec(cmd, { cwd: ROOT_DIR }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`Git 执行失败: ${stderr || stdout || err.message}`));
      }
      resolve({ stdout, stderr });
    });
  });
}
